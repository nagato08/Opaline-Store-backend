import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Accès à une commande passée sans compte.
 *
 * Deux portes d'entrée, toutes deux volontairement limitées :
 *  - un lien signé, envoyé dans l'email de confirmation ;
 *  - le couple numéro de commande + email, saisi sur le site.
 *
 * Le numéro seul ne suffit jamais : il est séquentiel et se devine.
 */
@Injectable()
export class OrderAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Lien de suivi à insérer dans les emails d'une commande sans compte. */
  buildTrackingUrl(order: {
    id: string;
    number: string;
    userId: string | null;
  }): string {
    const base = this.config.getOrThrow<string>('storefrontUrl');

    // Un client identifié retrouve sa commande depuis son espace : pas besoin
    // d'un lien porteur de jeton, qui resterait valable s'il fuitait.
    if (order.userId) {
      return `${base}/compte/commandes/${order.number}`;
    }

    return `${base}/commande/${order.number}?token=${this.issueToken(order.id)}`;
  }

  issueToken(orderId: string): string {
    const payload = Buffer.from(orderId).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  verifyToken(token: string): string {
    const [payload, signature] = token.split('.');

    if (!payload || !signature) {
      throw new BadRequestException('Lien de suivi invalide.');
    }

    const expected = Buffer.from(this.sign(payload));
    const received = Buffer.from(signature);

    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new BadRequestException('Lien de suivi invalide.');
    }

    return Buffer.from(payload, 'base64url').toString('utf8');
  }

  /**
   * Résolution par numéro + email. La comparaison de l'email est
   * insensible à la casse mais stricte : sans elle, connaître un numéro de
   * commande suffirait à lire l'adresse et le détail d'achat d'un client.
   */
  async resolveByNumberAndEmail(
    number: string,
    email: string,
  ): Promise<string> {
    const order = await this.prisma.order.findUnique({
      where: { number: number.trim().toUpperCase() },
      select: { id: true, email: true },
    });

    if (!order || order.email.toLowerCase() !== email.trim().toLowerCase()) {
      // Message identique dans les deux cas : distinguer « numéro inconnu » de
      // « email incorrect » permettrait d'énumérer les commandes existantes.
      throw new NotFoundException(
        'Aucune commande ne correspond à ces informations.',
      );
    }

    return order.id;
  }

  /**
   * Rattache une commande sans compte à l'utilisateur qui vient de s'inscrire.
   * L'email de la commande doit correspondre à celui du compte, sinon
   * n'importe qui pourrait s'approprier la commande d'un tiers.
   */
  async claim(orderId: string, userId: string, userEmail: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { id: true, userId: true, email: true, number: true },
    });

    if (order.userId && order.userId !== userId) {
      throw new BadRequestException(
        'Cette commande est déjà rattachée à un autre compte.',
      );
    }

    if (order.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new BadRequestException(
        'Cette commande a été passée avec une autre adresse email.',
      );
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: { userId },
      select: { id: true, number: true, userId: true },
    });
  }

  private sign(payload: string): string {
    return createHmac(
      'sha256',
      this.config.getOrThrow<string>('jwt.accessSecret'),
    )
      .update(`order:${payload}`)
      .digest('base64url');
  }
}
