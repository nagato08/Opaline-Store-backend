import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { Public } from '../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      async () => {
        const check = this.indicator.check('database');
        try {
          await this.prisma.$queryRaw`SELECT 1`;
          return check.up();
        } catch (error) {
          return check.down({ message: (error as Error).message });
        }
      },
      async () => {
        const check = this.indicator.check('redis');
        try {
          await this.redis.ping();
          return check.up();
        } catch (error) {
          return check.down({ message: (error as Error).message });
        }
      },
    ]);
  }

  @Public()
  @Get('live')
  live() {
    return { status: 'ok', uptime: process.uptime() };
  }
}
