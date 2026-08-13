import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CacheModule } from '@nestjs/cache-manager';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { LoggerModule } from 'nestjs-pino';
import KeyvRedis from '@keyv/redis';
import Keyv from 'keyv';

import { configuration } from './config/configuration';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { PricingModule } from './pricing/pricing.module';
import { MediaModule } from './media/media.module';
import { CatalogModule } from './catalog/catalog.module';
import { InventoryModule } from './inventory/inventory.module';
import { ShippingModule } from './shipping/shipping.module';
import { CartModule } from './cart/cart.module';
import { CheckoutModule } from './checkout/checkout.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { JobsModule } from './jobs/jobs.module';
import { PromotionsModule } from './promotions/promotions.module';
import { ContentModule } from './content/content.module';
import { MailModule } from './mail/mail.module';
import { LoyaltyModule } from './engagement/loyalty.module';
import { EngagementModule } from './engagement/engagement.module';
import { AuditModule } from './audit/audit.module';
import { AccountModule } from './account/account.module';
import { SearchModule } from './search/search.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { AuditInterceptor } from './audit/audit.interceptor';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('env') === 'production' ? 'info' : 'debug',
          transport:
            config.get<string>('env') === 'production'
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true } },
          // Ne jamais laisser fuir un jeton, un cookie ou un moyen de paiement
          // dans les logs.
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.newPassword',
            'req.body.currentPassword',
            'req.body.token',
          ],
          autoLogging: {
            ignore: (req) => req.url?.startsWith('/api/health') ?? false,
          },
        },
      }),
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.getOrThrow<number>('throttle.ttl') * 1000,
            limit: config.getOrThrow<number>('throttle.limit'),
          },
        ],
        storage: new ThrottlerStorageRedisService(
          config.getOrThrow<string>('redis.url'),
        ),
      }),
    }),

    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        stores: [
          new Keyv({
            store: new KeyvRedis(config.getOrThrow<string>('redis.url')),
          }),
        ],
        ttl: 60_000,
      }),
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>('redis.url') },
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86_400 },
        },
      }),
    }),

    RedisModule,
    PrismaModule,
    MailModule,
    AuditModule,
    LoyaltyModule,
    AuthModule,
    HealthModule,
    PricingModule,
    MediaModule,
    CatalogModule,
    InventoryModule,
    ShippingModule,
    PaymentsModule,
    PromotionsModule,
    ContentModule,
    EngagementModule,
    AccountModule,
    SearchModule,
    CartModule,
    OrdersModule,
    CheckoutModule,
    JobsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
