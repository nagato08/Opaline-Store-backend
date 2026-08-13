import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Locale } from '../generated/prisma/enums';

/**
 * Merchandising de la recherche : synonymes et mise en avant manuelle.
 * Ce sont les deux leviers qui permettent à la boutique de corriger un
 * résultat sans toucher au code.
 */
@Injectable()
export class SearchAdminService {
  constructor(private readonly prisma: PrismaService) {}

  listSynonyms() {
    return this.prisma.searchSynonym.findMany({ orderBy: { term: 'asc' } });
  }

  upsertSynonym(term: string, synonyms: string[], locale: Locale) {
    const normalized = this.normalize(term);

    return this.prisma.searchSynonym.upsert({
      where: { term_locale: { term: normalized, locale } },
      update: { synonyms, isActive: true },
      create: { term: normalized, synonyms, locale },
    });
  }

  async removeSynonym(id: string): Promise<void> {
    await this.prisma.searchSynonym.delete({ where: { id } });
  }

  listPins(term?: string) {
    return this.prisma.searchPin.findMany({
      where: term ? { term: this.normalize(term) } : {},
      orderBy: [{ term: 'asc' }, { position: 'asc' }],
      include: { product: { include: { translations: true } } },
    });
  }

  pinProduct(
    term: string,
    productId: string,
    position: number,
    locale: Locale,
  ) {
    const normalized = this.normalize(term);

    return this.prisma.searchPin.upsert({
      where: { term_locale_productId: { term: normalized, locale, productId } },
      update: { position },
      create: { term: normalized, productId, position, locale },
    });
  }

  async removePin(id: string): Promise<void> {
    await this.prisma.searchPin.delete({ where: { id } });
  }

  private normalize(term: string): string {
    return term.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
}
