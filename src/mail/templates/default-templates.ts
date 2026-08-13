import { MailTemplate, type MailTemplateCode } from '../mail.types';
import type { Locale } from '../../generated/prisma/enums';

export type TemplateDefinition = {
  subject: string;
  /** Corps du message, sans en-tête ni pied de page : la mise en page les ajoute. */
  body: string;
};

/**
 * Gabarits intégrés, utilisés tant que l'administration n'a pas défini sa
 * propre version dans `EmailTemplate`. Les variables sont interpolées par
 * `{{nom}}` et systématiquement échappées.
 */
export const DEFAULT_TEMPLATES: Record<
  MailTemplateCode,
  Record<Locale, TemplateDefinition>
> = {
  [MailTemplate.VerifyEmail]: {
    FR: {
      subject: 'Confirmez votre adresse email',
      body: `<p>Bonjour {{firstName}},</p>
<p>Bienvenue sur {{storeName}}. Confirmez votre adresse email pour activer votre compte.</p>
<p><a class="button" href="{{actionUrl}}">Confirmer mon adresse</a></p>
<p class="muted">Ce lien expire dans 24 heures. Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message.</p>`,
    },
    EN: {
      subject: 'Confirm your email address',
      body: `<p>Hi {{firstName}},</p>
<p>Welcome to {{storeName}}. Confirm your email address to activate your account.</p>
<p><a class="button" href="{{actionUrl}}">Confirm my address</a></p>
<p class="muted">This link expires in 24 hours. If you did not sign up, please ignore this message.</p>`,
    },
  },

  [MailTemplate.ResetPassword]: {
    FR: {
      subject: 'Réinitialisation de votre mot de passe',
      body: `<p>Bonjour {{firstName}},</p>
<p>Vous avez demandé à réinitialiser votre mot de passe.</p>
<p><a class="button" href="{{actionUrl}}">Choisir un nouveau mot de passe</a></p>
<p class="muted">Ce lien expire dans 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.</p>`,
    },
    EN: {
      subject: 'Reset your password',
      body: `<p>Hi {{firstName}},</p>
<p>You asked to reset your password.</p>
<p><a class="button" href="{{actionUrl}}">Choose a new password</a></p>
<p class="muted">This link expires in 1 hour. If you did not request it, ignore this message: your password stays unchanged.</p>`,
    },
  },

  [MailTemplate.PasswordChanged]: {
    FR: {
      subject: 'Votre mot de passe a été modifié',
      body: `<p>Bonjour {{firstName}},</p>
<p>Le mot de passe de votre compte vient d'être modifié et toutes vos sessions ont été déconnectées.</p>
<p class="muted">Si vous n'êtes pas à l'origine de ce changement, contactez-nous immédiatement à {{supportEmail}}.</p>`,
    },
    EN: {
      subject: 'Your password has been changed',
      body: `<p>Hi {{firstName}},</p>
<p>Your account password was just changed and all your sessions were signed out.</p>
<p class="muted">If this wasn't you, contact us immediately at {{supportEmail}}.</p>`,
    },
  },

  [MailTemplate.OrderConfirmation]: {
    FR: {
      subject: 'Votre commande {{orderNumber}} est enregistrée',
      body: `<p>Bonjour {{firstName}},</p>
<p>Nous avons bien reçu votre commande <strong>{{orderNumber}}</strong>.</p>
<table class="summary">
  <tr><td>Total</td><td class="right"><strong>{{total}}</strong></td></tr>
  <tr><td>Livraison</td><td class="right">{{shippingMethod}}</td></tr>
</table>
<p>{{paymentInstructions}}</p>
<p><a class="button" href="{{orderUrl}}">Suivre ma commande</a></p>`,
    },
    EN: {
      subject: 'Your order {{orderNumber}} is confirmed',
      body: `<p>Hi {{firstName}},</p>
<p>We have received your order <strong>{{orderNumber}}</strong>.</p>
<table class="summary">
  <tr><td>Total</td><td class="right"><strong>{{total}}</strong></td></tr>
  <tr><td>Delivery</td><td class="right">{{shippingMethod}}</td></tr>
</table>
<p>{{paymentInstructions}}</p>
<p><a class="button" href="{{orderUrl}}">Track my order</a></p>`,
    },
  },

  [MailTemplate.OrderPaid]: {
    FR: {
      subject: 'Paiement reçu pour la commande {{orderNumber}}',
      body: `<p>Bonjour {{firstName}},</p>
<p>Votre règlement de <strong>{{total}}</strong> a bien été encaissé. Votre commande {{orderNumber}} passe en préparation.</p>
<p>Votre facture {{invoiceNumber}} est disponible depuis votre compte.</p>
<p><a class="button" href="{{orderUrl}}">Voir ma commande</a></p>`,
    },
    EN: {
      subject: 'Payment received for order {{orderNumber}}',
      body: `<p>Hi {{firstName}},</p>
<p>Your payment of <strong>{{total}}</strong> has been received. Order {{orderNumber}} is now being prepared.</p>
<p>Invoice {{invoiceNumber}} is available from your account.</p>
<p><a class="button" href="{{orderUrl}}">View my order</a></p>`,
    },
  },

  [MailTemplate.OrderShipped]: {
    FR: {
      subject: 'Votre commande {{orderNumber}} est expédiée',
      body: `<p>Bonjour {{firstName}},</p>
<p>Votre commande <strong>{{orderNumber}}</strong> vient de partir avec {{carrier}}.</p>
<table class="summary">
  <tr><td>Numéro de suivi</td><td class="right">{{trackingNumber}}</td></tr>
</table>
<p><a class="button" href="{{trackingUrl}}">Suivre mon colis</a></p>`,
    },
    EN: {
      subject: 'Your order {{orderNumber}} has shipped',
      body: `<p>Hi {{firstName}},</p>
<p>Your order <strong>{{orderNumber}}</strong> has been shipped with {{carrier}}.</p>
<table class="summary">
  <tr><td>Tracking number</td><td class="right">{{trackingNumber}}</td></tr>
</table>
<p><a class="button" href="{{trackingUrl}}">Track my parcel</a></p>`,
    },
  },

  [MailTemplate.OrderCancelled]: {
    FR: {
      subject: 'Votre commande {{orderNumber}} a été annulée',
      body: `<p>Bonjour {{firstName}},</p>
<p>Votre commande <strong>{{orderNumber}}</strong> a été annulée. Motif : {{reason}}.</p>
<p class="muted">Si un paiement a été encaissé, il vous sera remboursé sous quelques jours ouvrés.</p>`,
    },
    EN: {
      subject: 'Your order {{orderNumber}} was cancelled',
      body: `<p>Hi {{firstName}},</p>
<p>Your order <strong>{{orderNumber}}</strong> has been cancelled. Reason: {{reason}}.</p>
<p class="muted">If a payment was taken, it will be refunded within a few business days.</p>`,
    },
  },

  [MailTemplate.OrderRefunded]: {
    FR: {
      subject: 'Remboursement de la commande {{orderNumber}}',
      body: `<p>Bonjour {{firstName}},</p>
<p>Un remboursement de <strong>{{amount}}</strong> a été émis pour votre commande {{orderNumber}}.</p>
<p class="muted">Le délai d'apparition sur votre relevé dépend de votre banque, comptez jusqu'à 10 jours ouvrés.</p>`,
    },
    EN: {
      subject: 'Refund for order {{orderNumber}}',
      body: `<p>Hi {{firstName}},</p>
<p>A refund of <strong>{{amount}}</strong> has been issued for your order {{orderNumber}}.</p>
<p class="muted">Depending on your bank, it may take up to 10 business days to appear on your statement.</p>`,
    },
  },

  [MailTemplate.NewsletterConfirm]: {
    FR: {
      subject: 'Confirmez votre inscription à la newsletter',
      body: `<p>Bonjour,</p>
<p>Confirmez votre inscription pour recevoir nos nouveautés et offres.</p>
<p><a class="button" href="{{actionUrl}}">Je confirme mon inscription</a></p>
<p class="muted">Vous pourrez vous désinscrire à tout moment depuis le bas de chaque message.</p>`,
    },
    EN: {
      subject: 'Confirm your newsletter subscription',
      body: `<p>Hello,</p>
<p>Confirm your subscription to receive our news and offers.</p>
<p><a class="button" href="{{actionUrl}}">Confirm my subscription</a></p>
<p class="muted">You can unsubscribe at any time from the footer of any message.</p>`,
    },
  },

  [MailTemplate.AbandonedCart]: {
    FR: {
      subject: 'Votre panier vous attend',
      body: `<p>Bonjour {{firstName}},</p>
<p>Vous avez laissé {{itemCount}} article(s) dans votre panier, pour un total de <strong>{{total}}</strong>.</p>
<p><a class="button" href="{{cartUrl}}">Reprendre ma commande</a></p>
<p class="muted">Les articles ne sont pas réservés et restent susceptibles d'être épuisés.</p>`,
    },
    EN: {
      subject: 'Your cart is waiting',
      body: `<p>Hi {{firstName}},</p>
<p>You left {{itemCount}} item(s) in your cart, totalling <strong>{{total}}</strong>.</p>
<p><a class="button" href="{{cartUrl}}">Resume my order</a></p>
<p class="muted">Items are not reserved and may sell out.</p>`,
    },
  },

  [MailTemplate.BackInStock]: {
    FR: {
      subject: '{{productName}} est de nouveau disponible',
      body: `<p>Bonjour,</p>
<p><strong>{{productName}}</strong> que vous suiviez est de nouveau en stock.</p>
<p><a class="button" href="{{productUrl}}">Voir le produit</a></p>`,
    },
    EN: {
      subject: '{{productName}} is back in stock',
      body: `<p>Hello,</p>
<p><strong>{{productName}}</strong> you were watching is available again.</p>
<p><a class="button" href="{{productUrl}}">View the product</a></p>`,
    },
  },
};

/** Mise en page commune : styles en ligne, seule méthode fiable en email. */
export function wrapLayout(input: {
  storeName: string;
  body: string;
  locale: Locale;
  unsubscribeUrl?: string;
}): string {
  const footer =
    input.locale === 'FR'
      ? `Cet email vous est envoyé par ${input.storeName}.`
      : `This email was sent to you by ${input.storeName}.`;

  const unsubscribe = input.unsubscribeUrl
    ? `<p style="margin:8px 0 0"><a href="${input.unsubscribeUrl}" style="color:#8a8a8a">${
        input.locale === 'FR' ? 'Se désinscrire' : 'Unsubscribe'
      }</a></p>`
    : '';

  return `<!doctype html>
<html lang="${input.locale.toLowerCase()}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1917">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px">
        <tr><td>
          <h1 style="margin:0 0 24px;font-size:20px;font-weight:600">${input.storeName}</h1>
          <div style="font-size:15px;line-height:1.6">${input.body}</div>
        </td></tr>
      </table>
      <p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#8a8a8a;text-align:center">${footer}${unsubscribe}</p>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Styles appliqués aux classes utilisées dans les gabarits. */
export const INLINE_STYLES: Record<string, string> = {
  button:
    'display:inline-block;background:#1c1917;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;margin:8px 0',
  muted: 'color:#78716c;font-size:13px',
  summary: 'width:100%;border-collapse:collapse;margin:16px 0;font-size:14px',
  right: 'text-align:right',
};
