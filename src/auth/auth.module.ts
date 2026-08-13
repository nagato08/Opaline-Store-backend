import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokensService,
    JwtStrategy,
    {
      // La stratégie Google n'est instanciée que si les identifiants OAuth sont
      // présents : sans ça, l'application refuse de démarrer en local.
      provide: GoogleStrategy,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('google.clientId')
          ? new GoogleStrategy(config)
          : null,
    },
  ],
  exports: [AuthService, TokensService],
})
export class AuthModule {}
