import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TokensService, type TokenPair } from './tokens.service';
import { MailService } from '../mail/mail.service';
import { MailTemplate } from '../mail/mail.types';
import { ConfigService } from '@nestjs/config';
import type { RegisterDto, LoginDto, UpdateProfileDto } from './dto/auth.dto';
import type { Locale } from '../generated/prisma/enums';

/** Après ce nombre d'échecs consécutifs, le compte est temporairement bloqué. */
const MAX_FAILED_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

type RequestContext = { ip?: string; userAgent?: string };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async register(
    dto: RegisterDto,
    context: RequestContext,
  ): Promise<TokenPair> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException(
        'Un compte existe déjà avec cette adresse email.',
      );
    }

    const defaultGroup = await this.prisma.customerGroup.findFirst({
      where: { isDefault: true },
    });

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash: await argon2.hash(dto.password),
        firstName: dto.firstName,
        lastName: dto.lastName,
        groupId: defaultGroup?.id,
      },
    });

    await this.createVerificationToken(
      user.id,
      user.email,
      user.locale,
      user.firstName,
    );

    return this.tokens.issue(user, context);
  }

  async login(dto: LoginDto, context: RequestContext): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    // Message volontairement identique dans tous les cas d'échec : révéler
    // qu'un email existe permettrait d'énumérer les comptes clients.
    const genericError = new UnauthorizedException('Identifiants invalides.');

    if (!user || !user.passwordHash) {
      throw genericError;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'Compte temporairement bloqué, réessayez plus tard.',
      );
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Compte inactif.');
    }

    const isValid = await argon2.verify(user.passwordHash, dto.password);

    if (!isValid) {
      await this.registerFailedAttempt(user.id, user.failedAttempts);
      throw genericError;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    return this.tokens.issue(user, context);
  }

  /**
   * Connexion Google. Le rattachement à un compte existant n'est autorisé que
   * si Google a vérifié l'email : sinon n'importe qui pourrait créer un compte
   * Google avec l'email d'un client et récupérer son compte boutique.
   */
  async loginWithGoogle(
    profile: {
      providerAccountId: string;
      email: string;
      emailVerified: boolean;
      firstName?: string;
      lastName?: string;
    },
    context: RequestContext,
  ): Promise<TokenPair> {
    const linked = await this.prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'google',
          providerAccountId: profile.providerAccountId,
        },
      },
      include: { user: true },
    });

    if (linked) {
      await this.prisma.user.update({
        where: { id: linked.userId },
        data: { lastLoginAt: new Date() },
      });
      return this.tokens.issue(linked.user, context);
    }

    if (!profile.emailVerified) {
      throw new UnauthorizedException('Adresse email non vérifiée par Google.');
    }

    const email = profile.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
      await this.prisma.account.create({
        data: {
          userId: existing.id,
          provider: 'google',
          providerAccountId: profile.providerAccountId,
          email,
        },
      });
      return this.tokens.issue(existing, context);
    }

    const defaultGroup = await this.prisma.customerGroup.findFirst({
      where: { isDefault: true },
    });

    const user = await this.prisma.user.create({
      data: {
        email,
        emailVerifiedAt: new Date(),
        firstName: profile.firstName,
        lastName: profile.lastName,
        groupId: defaultGroup?.id,
        lastLoginAt: new Date(),
        accounts: {
          create: {
            provider: 'google',
            providerAccountId: profile.providerAccountId,
            email,
          },
        },
      },
    });

    return this.tokens.issue(user, context);
  }

  async me(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        locale: true,
        currencyCode: true,
        acceptsMarketing: true,
        createdAt: true,
        group: { select: { id: true, code: true, name: true } },
        // Un compte Google sans mot de passe : le front masque « changer le
        // mot de passe » et propose « en définir un ».
        accounts: { select: { provider: true } },
      },
    });
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        locale: dto.locale ? (dto.locale.toUpperCase() as Locale) : undefined,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        locale: true,
      },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string | undefined,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    if (user.passwordHash) {
      if (
        !currentPassword ||
        !(await argon2.verify(user.passwordHash, currentPassword))
      ) {
        throw new UnauthorizedException('Mot de passe actuel incorrect.');
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(newPassword) },
    });

    // Un changement de mot de passe invalide toutes les sessions ouvertes.
    await this.tokens.revokeAllForUser(userId);

    // Alerte de sécurité : un changement non sollicité doit être détectable
    // immédiatement par le titulaire du compte.
    await this.mail.enqueue({
      to: user.email,
      template: MailTemplate.PasswordChanged,
      locale: user.locale,
      variables: { firstName: user.firstName },
      relatedType: 'user',
      relatedId: user.id,
    });
  }

  /**
   * Ne révèle jamais si l'email existe : la réponse est identique dans les deux
   * cas, seul l'envoi du message diffère.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      return;
    }

    const token = randomBytes(32).toString('base64url');

    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        identifier: user.email,
        tokenHash: this.tokens.hash(token),
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    await this.mail.enqueue({
      to: user.email,
      template: MailTemplate.ResetPassword,
      locale: user.locale,
      variables: {
        firstName: user.firstName,
        actionUrl: `${this.config.getOrThrow<string>('storefrontUrl')}/reinitialiser-mot-de-passe?token=${token}`,
      },
      relatedType: 'user',
      relatedId: user.id,
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const record = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: this.tokens.hash(token) },
    });

    if (
      !record ||
      record.type !== 'PASSWORD_RESET' ||
      record.usedAt ||
      record.expiresAt < new Date()
    ) {
      throw new BadRequestException('Lien invalide ou expiré.');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId as string },
        data: {
          passwordHash: await argon2.hash(password),
          failedAttempts: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.verificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    await this.tokens.revokeAllForUser(record.userId as string);
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: this.tokens.hash(token) },
    });

    if (
      !record ||
      record.type !== 'EMAIL_VERIFICATION' ||
      record.usedAt ||
      record.expiresAt < new Date()
    ) {
      throw new BadRequestException('Lien invalide ou expiré.');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId as string },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.verificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);
  }

  private async createVerificationToken(
    userId: string,
    email: string,
    locale: Locale = 'FR',
    firstName?: string | null,
  ): Promise<void> {
    const token = randomBytes(32).toString('base64url');

    await this.prisma.verificationToken.create({
      data: {
        userId,
        identifier: email,
        tokenHash: this.tokens.hash(token),
        type: 'EMAIL_VERIFICATION',
        expiresAt: new Date(Date.now() + 24 * 3600_000),
      },
    });

    await this.mail.enqueue({
      to: email,
      template: MailTemplate.VerifyEmail,
      locale,
      variables: {
        firstName,
        actionUrl: `${this.config.getOrThrow<string>('storefrontUrl')}/verifier-email?token=${token}`,
      },
      relatedType: 'user',
      relatedId: userId,
    });
  }

  private async registerFailedAttempt(
    userId: string,
    current: number,
  ): Promise<void> {
    const attempts = current + 1;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedAttempts: attempts,
        lockedUntil:
          attempts >= MAX_FAILED_ATTEMPTS
            ? new Date(Date.now() + LOCK_MINUTES * 60_000)
            : null,
      },
    });
  }
}
