import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { MailProvider, SendResult } from '../mail.types';

@Injectable()
export class ResendMailProvider implements MailProvider {
  readonly name = 'resend';
  private readonly logger = new Logger(ResendMailProvider.name);
  private readonly client: Resend | null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('mail.apiKey');
    this.client = apiKey ? new Resend(apiKey) : null;
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  async send(message: {
    to: string;
    from: string;
    replyTo?: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<SendResult> {
    if (!this.client) {
      return {
        providerId: null,
        succeeded: false,
        error: 'Resend non configuré.',
      };
    }

    const { data, error } = await this.client.emails.send({
      from: message.from,
      to: [message.to],
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (error) {
      // L'erreur est renvoyée plutôt que levée : la file décide seule s'il
      // faut réessayer, et un échec d'envoi ne doit jamais casser l'appelant.
      this.logger.warn(`Échec d'envoi à ${message.to} : ${error.message}`);
      return { providerId: null, succeeded: false, error: error.message };
    }

    return { providerId: data?.id ?? null, succeeded: true };
  }
}
