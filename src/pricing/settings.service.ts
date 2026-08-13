import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';

const CACHE_PREFIX = 'setting:';
const CACHE_TTL_MS = 300_000;

/** Accès typé et mis en cache aux réglages boutique. */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const cached = await this.cache.get<T>(CACHE_PREFIX + key);

    if (cached !== undefined && cached !== null) {
      return cached;
    }

    const setting = await this.prisma.setting.findUnique({ where: { key } });
    const value = (setting?.value as T | undefined) ?? fallback;

    await this.cache.set(CACHE_PREFIX + key, value, CACHE_TTL_MS);

    return value;
  }

  async set(key: string, value: unknown, group = 'general'): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      update: { value: value as object, group },
      create: { key, value: value as object, group },
    });

    await this.cache.del(CACHE_PREFIX + key);
  }

  /** Régime d'affichage : TTC en UE, HT en Amérique du Nord. */
  pricesIncludeTax(): Promise<boolean> {
    return this.get<boolean>('tax.pricesIncludeTax', true);
  }
}
