import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  type Paginated,
  PaginationDto,
  paginate,
} from '../common/dto/pagination.dto';

export type CustomerKind = 'account' | 'guest';

export type CustomerSummary = {
  kind: CustomerKind;
  /** Nul pour un acheteur invité : il n'a pas de compte. */
  userId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  countryCode: string | null;
  orderCount: number;
  spentCents: number;
  lastOrderAt: Date | null;
};

/**
 * Vue « clients » du back-office.
 *
 * Une commande peut être passée sans compte : la clientèle ne se résume donc
 * pas à la table `User`. L'identité commerciale est le **courriel**, présent
 * sur toute commande, avec ou sans compte — c'est lui qui sert de clé ici.
 *
 * Distinguer les deux n'est pas cosmétique : promettre un historique à qui
 * n'a pas de compte, ou compter deux fois quelqu'un qui a fini par en créer
 * un, fausse aussi bien l'écran que les relances marketing.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    dto: PaginationDto,
    filters: { kind?: CustomerKind; search?: string },
  ): Promise<Paginated<CustomerSummary>> {
    /* Agrégation par courriel plutôt que par `userId` : c'est le seul champ
       commun aux commandes avec et sans compte. Les commandes annulées sont
       exclues du chiffre dépensé — les compter gonflerait la valeur d'un
       client qui n'a rien acheté. */
    const grouped = await this.prisma.order.groupBy({
      by: ['email'],
      where: {
        status: { not: 'CANCELLED' },
        email: filters.search
          ? { contains: filters.search, mode: 'insensitive' }
          : undefined,
      },
      _count: { _all: true },
      _sum: { totalCents: true },
      _max: { createdAt: true },
    });

    const emails = grouped.map((row) => row.email);

    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { email: { in: emails } },
          // Un compte sans aucune commande reste un client : il a créé un
          // compte, il doit apparaître, avec un compteur à zéro.
          filters.search
            ? {
                OR: [
                  { email: { contains: filters.search, mode: 'insensitive' } },
                  {
                    firstName: {
                      contains: filters.search,
                      mode: 'insensitive',
                    },
                  },
                  {
                    lastName: { contains: filters.search, mode: 'insensitive' },
                  },
                ],
              }
            : {},
        ],
        role: 'CUSTOMER',
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        createdAt: true,
      },
    });

    const byEmail = new Map(grouped.map((row) => [row.email, row]));
    const seen = new Set<string>();
    const rows: CustomerSummary[] = [];

    for (const user of users) {
      const stats = byEmail.get(user.email);
      seen.add(user.email);

      rows.push({
        kind: 'account',
        userId: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        countryCode: null,
        orderCount: stats?._count._all ?? 0,
        spentCents: stats?._sum.totalCents ?? 0,
        lastOrderAt: stats?._max.createdAt ?? null,
      });
    }

    for (const row of grouped) {
      if (seen.has(row.email)) continue;

      rows.push({
        kind: 'guest',
        userId: null,
        email: row.email,
        firstName: null,
        lastName: null,
        countryCode: null,
        orderCount: row._count._all,
        spentCents: row._sum.totalCents ?? 0,
        lastOrderAt: row._max.createdAt,
      });
    }

    const filtered = filters.kind
      ? rows.filter((row) => row.kind === filters.kind)
      : rows;

    // Les meilleurs clients d'abord : c'est l'ordre utile quand on ouvre cet
    // écran sans chercher quelqu'un en particulier.
    filtered.sort((a, b) => b.spentCents - a.spentCents);

    /* Pagination en mémoire : l'union « comptes + invités » ne s'exprime pas
       en une requête SQL sans vue dédiée, et cette boutique compte quelques
       milliers de clients. À revoir si le catalogue de clientèle explose. */
    return paginate(
      filtered.slice(dto.skip, dto.skip + dto.perPage),
      filtered.length,
      dto,
    );
  }

  /**
   * Fiche client, retrouvée par courriel — la seule clé qui marche pour un
   * acheteur invité comme pour un titulaire de compte.
   */
  async findByEmail(email: string) {
    const [user, orders] = await Promise.all([
      this.prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          locale: true,
          currencyCode: true,
          acceptsMarketing: true,
          createdAt: true,
          addresses: true,
          consents: {
            orderBy: { createdAt: 'desc' },
            select: {
              type: true,
              isGranted: true,
              createdAt: true,
              version: true,
            },
          },
          loyaltyAccount: { select: { points: true, tier: true } },
        },
      }),
      this.prisma.order.findMany({
        where: { email },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          number: true,
          status: true,
          paymentStatus: true,
          totalCents: true,
          currencyCode: true,
          pricesIncludeTax: true,
          createdAt: true,
        },
      }),
    ]);

    if (!user && orders.length === 0) {
      throw new NotFoundException('Client introuvable.');
    }

    const spentCents = orders
      .filter((order) => order.status !== 'CANCELLED')
      .reduce((sum, order) => sum + order.totalCents, 0);

    return {
      kind: user ? 'account' : 'guest',
      email,
      user,
      orders,
      stats: {
        orderCount: orders.filter((order) => order.status !== 'CANCELLED')
          .length,
        spentCents,
        lastOrderAt: orders[0]?.createdAt ?? null,
      },
    };
  }
}
