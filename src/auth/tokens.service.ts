import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { Role } from '../generated/prisma/enums';

export type JwtPayload = {
  sub: string;
  email: string;
  role: Role;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

const REFRESH_COOKIE = 'refresh_token';
const ACCESS_COOKIE = 'access_token';

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Émet une paire de jetons. Le refresh token est opaque, stocké haché, et
   * rattaché à une « famille » : si un jeton déjà utilisé réapparaît, toute la
   * famille est révoquée (détection de vol de jeton).
   */
  async issue(
    user: { id: string; email: string; role: Role },
    context: { ip?: string; userAgent?: string; familyId?: string },
  ): Promise<TokenPair> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('jwt.accessSecret'),
      expiresIn: this.accessTtlSeconds(),
    });

    const refreshToken = randomBytes(48).toString('base64url');
    const ttlDays = this.parseDays(
      this.config.getOrThrow<string>('jwt.refreshTtl'),
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hash(refreshToken),
        familyId: context.familyId ?? randomUUID(),
        ip: context.ip,
        userAgent: context.userAgent,
        expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
      },
    });

    return { accessToken, refreshToken, expiresIn: this.accessTtlSeconds() };
  }

  /** Vérifie un refresh token, le consomme et en émet un nouveau (rotation). */
  async rotate(
    rawToken: string,
    context: { ip?: string; userAgent?: string },
  ): Promise<TokenPair & { userId: string }> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
      include: { user: true },
    });

    if (!stored) {
      throw new UnauthorizedException('Session invalide.');
    }

    if (stored.revokedAt) {
      // Jeton déjà consommé : soit rejeu, soit vol. On coupe toute la famille.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Session révoquée, reconnectez-vous.');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expirée.');
    }

    if (stored.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Compte inactif.');
    }

    const pair = await this.issue(stored.user, {
      ...context,
      familyId: stored.familyId,
    });

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedBy: this.hash(pair.refreshToken) },
    });

    return { ...pair, userId: stored.userId };
  }

  async revoke(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Pose les cookies httpOnly ; le front n'a jamais à manipuler les jetons. */
  setCookies(response: Response, tokens: TokenPair): void {
    const isProduction = this.config.get<string>('env') === 'production';
    const base = {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax' as const,
      path: '/',
    };

    response.cookie(ACCESS_COOKIE, tokens.accessToken, {
      ...base,
      maxAge: tokens.expiresIn * 1000,
    });

    response.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...base,
      path: '/api/auth',
      maxAge:
        this.parseDays(this.config.getOrThrow<string>('jwt.refreshTtl')) *
        86_400_000,
    });
  }

  clearCookies(response: Response): void {
    response.clearCookie(ACCESS_COOKIE, { path: '/' });
    response.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }

  hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  static get refreshCookieName(): string {
    return REFRESH_COOKIE;
  }

  static get accessCookieName(): string {
    return ACCESS_COOKIE;
  }

  private accessTtlSeconds(): number {
    const ttl = this.config.getOrThrow<string>('jwt.accessTtl');
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 900;

    const value = parseInt(match[1], 10);
    const unit = match[2];
    const factors: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * factors[unit];
  }

  private parseDays(ttl: string): number {
    const match = /^(\d+)d$/.exec(ttl);
    return match ? parseInt(match[1], 10) : 30;
  }
}
