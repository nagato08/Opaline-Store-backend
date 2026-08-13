import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { MailTemplate, type MailTemplateCode } from './mail.types';

/**
 * Gabarits de nature commerciale. Seuls ceux-là portent un lien de
 * désinscription : la loi l'impose sur la prospection, et l'ajouter sur un
 * message transactionnel (facture, réinitialisation de mot de passe) laisserait
 * croire au client qu'il peut refuser des messages qu'il doit recevoir.
 */
const MARKETING_TEMPLATES: MailTemplateCode[] = [
  MailTemplate.NewsletterConfirm,
  MailTemplate.AbandonedCart,
  MailTemplate.BackInStock,
];

@Injectable()
export class UnsubscribeService {
  constructor(private readonly config: ConfigService) {}

  isMarketing(template: MailTemplateCode): boolean {
    return MARKETING_TEMPLATES.includes(template);
  }

  /**
   * Lien signé : le destinataire se désinscrit en un clic, sans compte ni mot
   * de passe. La signature empêche de désinscrire l'adresse d'un tiers en
   * modifiant le paramètre.
   */
  buildUrl(email: string): string {
    const payload = Buffer.from(email.toLowerCase()).toString('base64url');
    const token = `${payload}.${this.sign(payload)}`;

    return `${this.config.getOrThrow<string>('storefrontUrl')}/newsletter/desinscription?token=${token}`;
  }

  /** Vérifie la signature et rend l'adresse, ou refuse. */
  verify(token: string): string {
    const [payload, signature] = token.split('.');

    if (!payload || !signature) {
      throw new BadRequestException('Lien de désinscription invalide.');
    }

    const expected = Buffer.from(this.sign(payload));
    const received = Buffer.from(signature);

    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new BadRequestException('Lien de désinscription invalide.');
    }

    return Buffer.from(payload, 'base64url').toString('utf8');
  }

  private sign(payload: string): string {
    return createHmac(
      'sha256',
      this.config.getOrThrow<string>('jwt.accessSecret'),
    )
      .update(payload)
      .digest('base64url');
  }
}
