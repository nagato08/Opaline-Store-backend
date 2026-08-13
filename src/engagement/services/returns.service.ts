import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../../orders/orders.service';
import { InventoryService } from '../../inventory/inventory.service';
import { paginate, type PaginationDto } from '../../common/dto/pagination.dto';
import { Prisma } from '../../generated/prisma/client';
import type { ReturnStatus } from '../../generated/prisma/enums';
import type { CreateReturnDto, ProcessReturnDto } from '../dto/engagement.dto';

/**
 * Droit de rétractation européen : 14 jours à compter de la réception.
 * Au-delà, un retour reste possible au titre de la garantie légale, mais il
 * n'est plus de droit et passe par une validation manuelle.
 */
const WITHDRAWAL_DAYS = 14;

@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * Demande de retour, sur une commande payée.
   *
   * `scope` distingue le client connecté (la commande doit lui appartenir) du
   * client sans compte, dont l'accès est prouvé par le jeton signé reçu par
   * email. Sans cette seconde voie, un achat invité serait un achat sans
   * droit de rétractation exerçable en ligne.
   */
  async create(
    dto: CreateReturnDto,
    scope: { userId?: string; guestOrderId?: string },
  ) {
    if (scope.guestOrderId && scope.guestOrderId !== dto.orderId) {
      throw new ForbiddenException(
        'Ce jeton ne correspond pas à cette commande.',
      );
    }

    const order = await this.prisma.order.findFirst({
      where: {
        id: dto.orderId,
        ...(scope.userId ? { userId: scope.userId } : {}),
      },
      include: {
        items: true,
        shipments: true,
        returnRequests: { include: { items: true } },
      },
    });

    if (!order) {
      throw new BadRequestException('Commande introuvable.');
    }

    if (order.paymentStatus !== 'PAID') {
      throw new BadRequestException('Cette commande n’a pas été payée.');
    }

    const deliveredAt =
      order.shipments.find((shipment) => shipment.deliveredAt)?.deliveredAt ??
      order.shipments.find((shipment) => shipment.shippedAt)?.shippedAt;

    const isWithinWithdrawal =
      !deliveredAt ||
      Date.now() - deliveredAt.getTime() <= WITHDRAWAL_DAYS * 86_400_000;

    for (const line of dto.items) {
      const item = order.items.find(
        (candidate) => candidate.id === line.orderItemId,
      );

      if (!item) {
        throw new BadRequestException('Ligne de commande inconnue.');
      }

      // Un article déjà retourné ne peut pas l'être une seconde fois.
      const alreadyReturned = order.returnRequests
        .flatMap((request) => request.items)
        .filter((returnItem) => returnItem.orderItemId === line.orderItemId)
        .reduce((sum, returnItem) => sum + Number(returnItem.quantity), 0);

      if (line.quantity + alreadyReturned > Number(item.quantity)) {
        throw new BadRequestException(
          `Quantité retournée supérieure à la quantité commandée pour ${item.sku}.`,
        );
      }
    }

    const number = `RET-${order.number.split('-').pop()}-${Date.now().toString().slice(-4)}`;

    const request = await this.prisma.returnRequest.create({
      data: {
        number,
        orderId: order.id,
        userId: scope.userId ?? order.userId,
        resolution: dto.resolution ?? 'REFUND',
        reason: dto.reason,
        customerComment: dto.customerComment,
        // Hors délai de rétractation, la demande reste à instruire par le
        // service client au lieu d'être acquise de droit.
        status: 'REQUESTED',
        items: {
          create: dto.items.map((line) => ({
            orderItemId: line.orderItemId,
            quantity: line.quantity,
            reason: line.reason,
          })),
        },
      },
      include: { items: true },
    });

    this.logger.log(
      `Retour ${number} demandé sur ${order.number} (rétractation : ${isWithinWithdrawal ? 'oui' : 'non'}).`,
    );

    return { ...request, isWithinWithdrawalPeriod: isWithinWithdrawal };
  }

  async listForCustomer(userId: string, dto: PaginationDto) {
    const where: Prisma.ReturnRequestWhereInput = { userId };

    const [items, total] = await Promise.all([
      this.prisma.returnRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: dto.skip,
        take: dto.perPage,
        include: { items: true, order: { select: { number: true } } },
      }),
      this.prisma.returnRequest.count({ where }),
    ]);

    return paginate(items, total, dto);
  }

  async findOne(
    id: string,
    scope: { userId?: string; isStaff?: boolean; guestOrderId?: string },
  ) {
    const request = await this.prisma.returnRequest.findUniqueOrThrow({
      where: { id },
      include: {
        items: { include: { orderItem: true } },
        order: { select: { number: true, currencyCode: true, locale: true } },
        refund: true,
      },
    });

    const isOwner = scope.userId && request.userId === scope.userId;
    const isGuestHolder =
      scope.guestOrderId && request.orderId === scope.guestOrderId;

    if (!scope.isStaff && !isOwner && !isGuestHolder) {
      throw new ForbiddenException('Cette demande ne vous appartient pas.');
    }

    return request;
  }

  async listForAdmin(dto: PaginationDto, status?: ReturnStatus) {
    const where: Prisma.ReturnRequestWhereInput = { status };

    const [items, total] = await Promise.all([
      this.prisma.returnRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: dto.skip,
        take: dto.perPage,
        include: {
          items: true,
          order: { select: { number: true, email: true } },
        },
      }),
      this.prisma.returnRequest.count({ where }),
    ]);

    return paginate(items, total, dto);
  }

  approve(id: string, adminComment?: string) {
    return this.prisma.returnRequest.update({
      where: { id },
      data: { status: 'APPROVED', approvedAt: new Date(), adminComment },
      include: { items: true },
    });
  }

  reject(id: string, adminComment?: string) {
    return this.prisma.returnRequest.update({
      where: { id },
      data: { status: 'REJECTED', closedAt: new Date(), adminComment },
    });
  }

  /**
   * Réception du colis retourné : remise en stock optionnelle puis
   * remboursement. Le stock n'est jamais réintégré automatiquement — un article
   * peut revenir abîmé, ouvert ou périmé, et l'agent seul peut en juger.
   */
  async receive(id: string, dto: ProcessReturnDto, actorId: string) {
    const request = await this.prisma.returnRequest.findUniqueOrThrow({
      where: { id },
      include: {
        items: { include: { orderItem: true } },
        order: true,
      },
    });

    if (request.status === 'COMPLETED') {
      throw new BadRequestException('Ce retour est déjà clôturé.');
    }

    const location = await this.prisma.location.findFirst({
      where: { isDefault: true },
    });

    if (dto.restock && location) {
      for (const item of request.items) {
        if (!item.orderItem.variantId) continue;

        await this.inventory.adjust({
          variantId: item.orderItem.variantId,
          locationId: location.id,
          quantity: Number(item.quantity),
          type: 'RETURN',
          reason: `Retour ${request.number}`,
          actorId,
        });

        await this.prisma.returnItem.update({
          where: { id: item.id },
          data: { isRestocked: true },
        });
      }
    }

    const refundAmount =
      dto.refundAmountCents ??
      request.items.reduce((sum, item) => {
        const unit =
          item.orderItem.totalCents / Number(item.orderItem.quantity);
        return sum + Math.round(unit * Number(item.quantity));
      }, 0);

    let refundId: string | null = null;

    if (request.resolution === 'REFUND' && refundAmount > 0) {
      const order = await this.orders.refund(
        request.orderId,
        refundAmount,
        actorId,
        `Retour ${request.number}`,
      );

      refundId = order.refunds.at(-1)?.id ?? null;
    }

    return this.prisma.returnRequest.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        receivedAt: new Date(),
        closedAt: new Date(),
        adminComment: dto.adminComment,
        refundId,
      },
      include: { items: true, refund: true },
    });
  }
}
