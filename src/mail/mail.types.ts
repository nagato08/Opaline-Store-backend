import type { Locale } from '../generated/prisma/enums';

/**
 * Codes de gabarits. Les valeurs servent de clé dans la table `EmailTemplate` :
 * l'administration peut réécrire n'importe quel message sans redéploiement, le
 * gabarit intégré servant de repli.
 */
export const MailTemplate = {
  VerifyEmail: 'auth.verify-email',
  ResetPassword: 'auth.reset-password',
  PasswordChanged: 'auth.password-changed',
  OrderConfirmation: 'order.confirmation',
  OrderPaid: 'order.paid',
  OrderShipped: 'order.shipped',
  OrderCancelled: 'order.cancelled',
  OrderRefunded: 'order.refunded',
  NewsletterConfirm: 'newsletter.confirm',
  AbandonedCart: 'cart.abandoned',
  BackInStock: 'catalog.back-in-stock',
} as const;

export type MailTemplateCode = (typeof MailTemplate)[keyof typeof MailTemplate];

export type SendMailInput = {
  to: string;
  template: MailTemplateCode;
  locale: Locale;
  variables: Record<string, string | number | null | undefined>;
  /** Rattachement pour le support : « quels emails a reçu cette commande ? ». */
  relatedType?: string;
  relatedId?: string;
  replyTo?: string;
};

export type SendResult = {
  providerId: string | null;
  succeeded: boolean;
  error?: string;
};

/**
 * Port d'envoi. Changer de prestataire (Resend, Postmark, SES) ne doit toucher
 * qu'une classe d'adaptateur.
 */
export interface MailProvider {
  readonly name: string;
  readonly isConfigured: boolean;

  send(message: {
    to: string;
    from: string;
    replyTo?: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<SendResult>;
}

export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');
export const MAIL_QUEUE = 'mail';
