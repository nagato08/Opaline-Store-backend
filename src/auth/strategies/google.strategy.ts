import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import {
  Profile,
  Strategy,
  type VerifyCallback,
} from 'passport-google-oauth20';

export type GoogleProfile = {
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
};

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('google.clientId') ?? 'missing',
      clientSecret: config.get<string>('google.clientSecret') ?? 'missing',
      callbackURL: config.get<string>('google.callbackUrl') ?? 'missing',
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const primaryEmail = profile.emails?.[0];

    const user: GoogleProfile = {
      providerAccountId: profile.id,
      email: primaryEmail?.value ?? '',
      // Google renvoie `verified` sur l'email ; sans cette garantie, on refuse
      // de rattacher le compte à un utilisateur existant.
      emailVerified: primaryEmail?.verified === true,
      firstName: profile.name?.givenName,
      lastName: profile.name?.familyName,
    };

    done(null, user);
  }
}
