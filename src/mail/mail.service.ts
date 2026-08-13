import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../pricing/settings.service';
import { UnsubscribeService } from './unsubscribe.service';
import { MAIL_QUEUE, type SendMailInput } from './mail.types';
import {
  DEFAULT_TEMPLATES,
  INLINE_STYLES,
  wrapLayout,
} from './templates/default-templates';
import type { Locale } from '../generated/prisma/enums';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @InjectQueue(MAIL_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
    private readonly unsubscribe: UnsubscribeService,
  ) {}

  /**
   * Met un email en file. L'appelant n'attend jamais l'envoi : un prestataire
   * lent ou indisponible ne doit pas ralentir un paiement ni faire échouer une
   * inscription. La file gère les tentatives.
   */
  async enqueue(input: SendMailInput): Promise<void> {
    await this.queue.add('send', input, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 86_400, count: 500 },
    });
  }

  /** Rendu puis envoi effectif : appelé par le worker, pas par les services. */
  async render(
    input: SendMailInput,
  ): Promise<{ subject: string; html: string; text: string }> {
    const storeName = await this.settings.get<string>('store.name', 'Boutique');
    const supportEmail = await this.settings.get<string>('store.email', '');

    const custom = await this.prisma.emailTemplate.findUnique({
      where: { code_locale: { code: input.template, locale: input.locale } },
    });

    const fallback = this.defaultFor(input.template, input.locale);

    const variables = {
      storeName,
      supportEmail,
      firstName:
        input.variables.firstName ||
        (input.locale === 'FR' ? 'bonjour' : 'there'),
      ...input.variables,
    };

    // Le sujet et la version texte sont du texte brut : les échapper y
    // ferait apparaître des entités HTML (« d&#39;angle ») au lieu du
    // caractère attendu. Seul le corps HTML est échappé.
    const subject = this.interpolate(
      custom?.subject ?? fallback.subject,
      variables,
      false,
    );

    const rawBody = custom?.html ?? fallback.body;
    const body = this.applyStyles(this.interpolate(rawBody, variables, true));

    const html = custom?.html
      ? // Un gabarit personnalisé est considéré comme complet : l'admin
        // maîtrise sa mise en page et on n'y ajoute pas la nôtre.
        body
      : wrapLayout({
          storeName,
          body,
          locale: input.locale,
          // Lien de désinscription obligatoire sur la prospection, absent des
          // messages transactionnels.
          unsubscribeUrl: this.unsubscribe.isMarketing(input.template)
            ? this.unsubscribe.buildUrl(input.to)
            : undefined,
        });

    return {
      subject,
      html,
      text: custom?.text
        ? this.interpolate(custom.text, variables, false)
        : this.toPlainText(this.interpolate(rawBody, variables, false)),
    };
  }

  from(): string {
    return this.config.getOrThrow<string>('mail.from');
  }

  replyTo(): string | undefined {
    return this.config.get<string>('mail.replyTo') || undefined;
  }

  isEnabled(): boolean {
    return Boolean(this.config.get<string>('mail.apiKey'));
  }

  private defaultFor(code: string, locale: Locale) {
    const template = DEFAULT_TEMPLATES[code as keyof typeof DEFAULT_TEMPLATES];

    if (!template) {
      this.logger.warn(`Gabarit inconnu : ${code}`);
      return { subject: code, body: '' };
    }

    return template[locale] ?? template.FR;
  }

  /**
   * Interpolation `{{clé}}`. Les valeurs sont échappées : un nom de client
   * contenant du HTML ne doit pas pouvoir injecter de balise dans le message.
   */
  private interpolate(
    template: string,
    variables: Record<string, string | number | null | undefined>,
    escape: boolean,
  ): string {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
      const value = variables[key];

      if (value === undefined || value === null) {
        return '';
      }

      return escape ? this.escapeHtml(String(value)) : String(value);
    });
  }

  /** Les clients mail ignorent les feuilles de style : tout doit être en ligne. */
  private applyStyles(html: string): string {
    return html.replace(/class="(\w+)"/g, (match, className: string) => {
      const style = INLINE_STYLES[className];
      return style ? `style="${style}"` : match;
    });
  }

  private toPlainText(html: string): string {
    return html
      .replace(/<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/g, '$2 ($1)')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<\/p>/g, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
