import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';
import {
  MAIL_PROVIDER,
  MAIL_QUEUE,
  type MailProvider,
  type SendMailInput,
} from './mail.types';

@Processor(MAIL_QUEUE, { concurrency: 5 })
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
    @Inject(MAIL_PROVIDER) private readonly provider: MailProvider,
  ) {
    super();
  }

  async process(
    job: Job<SendMailInput>,
  ): Promise<{ providerId: string | null }> {
    const input = job.data;
    const { subject, html, text } = await this.mail.render(input);

    const log = await this.prisma.emailLog.create({
      data: {
        to: input.to,
        templateCode: input.template,
        subject,
        status: 'QUEUED',
        relatedType: input.relatedType,
        relatedId: input.relatedId,
      },
    });

    if (!this.provider.isConfigured) {
      // Sans clé d'API, le message est tracé mais pas envoyé : le
      // développement local reste possible sans compte prestataire.
      this.logger.warn(
        `Envoi désactivé — ${input.template} vers ${input.to} non expédié.`,
      );
      await this.prisma.emailLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', error: 'Fournisseur non configuré' },
      });
      return { providerId: null };
    }

    const result = await this.provider.send({
      to: input.to,
      from: this.mail.from(),
      replyTo: input.replyTo ?? this.mail.replyTo(),
      subject,
      html,
      text,
    });

    await this.prisma.emailLog.update({
      where: { id: log.id },
      data: {
        status: result.succeeded ? 'SENT' : 'FAILED',
        providerId: result.providerId,
        error: result.error,
        sentAt: result.succeeded ? new Date() : null,
      },
    });

    if (!result.succeeded) {
      // On relance l'erreur pour que BullMQ réessaie selon sa politique.
      throw new Error(result.error ?? 'Envoi échoué');
    }

    this.logger.log(
      `${input.template} envoyé à ${input.to} (${result.providerId}).`,
    );

    return { providerId: result.providerId };
  }
}
