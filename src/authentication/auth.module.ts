import { Module } from '@nestjs/common';
import { AuthService } from './services/authentication/auth.service';
import { AuthController } from './controllers/authentication/auth.controller';
import { UsersService } from '../users/services/users/users.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../typeorm/entities/user';
import { LocalStrategy } from '../utils/local.strategy';
import { SessionSerializer } from '../utils/session.serializer';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [JwtModule, TypeOrmModule.forFeature([User])],
  controllers: [AuthController],
  providers: [
    {
      provide: 'AUTH_SERVICE',
      useClass: AuthService,
    },
    UsersService,
    LocalStrategy,
    SessionSerializer,
  ],
  exports: [
    {
      provide: 'AUTH_SERVICE',
      useClass: AuthService,
    },
  ],
})
export class AuthModule {}
