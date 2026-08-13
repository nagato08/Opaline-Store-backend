import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../pricing/settings.service';
import { Prisma } from '../generated/prisma/client';

/**
 * Numérotation via des séquences Postgres : contrairement à un `count() + 1`,
 * une séquence ne produit jamais de doublon même sous forte concurrence, et la
 * numérotation des factures doit être continue et sans trou pour être valable
 * comptablement.
 */
@Injectable()
export class OrderNumberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
    const prefix = await this.settings.get<string>('order.numberPrefix', 'CMD');
    const [{ value }] = await tx.$queryRaw<{ value: bigint }[]>`
      SELECT nextval('order_number_seq') AS value
    `;

    const year = new Date().getFullYear();

    return `${prefix}-${year}-${value.toString().padStart(6, '0')}`;
  }

  async nextInvoiceNumber(
    tx: Prisma.TransactionClient,
    type: 'INVOICE' | 'CREDIT_NOTE' = 'INVOICE',
  ): Promise<string> {
    const [{ value }] = await tx.$queryRaw<{ value: bigint }[]>`
      SELECT nextval('invoice_number_seq') AS value
    `;

    const year = new Date().getFullYear();
    const prefix = type === 'CREDIT_NOTE' ? 'AV' : 'FA';

    return `${prefix}-${year}-${value.toString().padStart(6, '0')}`;
  }
}
