import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';
import type { GoogleProfile } from './strategies/google.strategy';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { Public } from '../common/decorators/public.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const pair = await this.auth.register(dto, this.context(request));
    this.tokens.setCookies(response, pair);
    return { accessToken: pair.accessToken, expiresIn: pair.expiresIn };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const pair = await this.auth.login(dto, this.context(request));
    this.tokens.setCookies(response, pair);
    return { accessToken: pair.accessToken, expiresIn: pair.expiresIn };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = this.readRefreshToken(request);

    if (!token) {
      throw new UnauthorizedException('Aucune session à renouveler.');
    }

    const pair = await this.tokens.rotate(token, this.context(request));
    this.tokens.setCookies(response, pair);
    return { accessToken: pair.accessToken, expiresIn: pair.expiresIn };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = this.readRefreshToken(request);

    if (token) {
      await this.tokens.revoke(token);
    }

    this.tokens.clearCookies(response);
  }

  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth(): void {
    // Passport prend la main et redirige vers Google.
  }

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() request: Request, @Res() response: Response) {
    const profile = request.user as GoogleProfile;
    const pair = await this.auth.loginWithGoogle(
      profile,
      this.context(request),
    );

    this.tokens.setCookies(response, pair);
    response.redirect(
      `${this.config.getOrThrow<string>('storefrontUrl')}/auth/callback`,
    );
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    return { message: 'Si un compte existe, un email vient d’être envoyé.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.auth.verifyEmail(dto.token);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }

  @Patch('me')
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(user.id, dto);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
    );
    this.tokens.clearCookies(response);
  }

  private context(request: Request) {
    return { ip: request.ip, userAgent: request.header('user-agent') };
  }

  private readRefreshToken(request: Request): string | undefined {
    const fromCookie = (
      request.cookies as Record<string, string> | undefined
    )?.[TokensService.refreshCookieName];
    const fromBody = (request.body as { refreshToken?: string } | undefined)
      ?.refreshToken;
    return fromCookie ?? fromBody;
  }
}
