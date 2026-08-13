import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { TokensService, type JwtPayload } from '../tokens.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      // Le navigateur envoie un cookie httpOnly ; les clients API (admin, tests,
      // intégrations) utilisent l'en-tête Authorization.
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) =>
          (request.cookies as Record<string, string> | undefined)?.[
            TokensService.accessCookieName
          ] ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.accessSecret'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        locale: true,
        currencyCode: true,
        groupId: true,
        status: true,
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Compte inactif ou supprimé.');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      locale: user.locale,
      currencyCode: user.currencyCode,
      groupId: user.groupId,
    };
  }
}
