import { Module } from '@nestjs/common';
import { AuthService } from './services/authentication/auth.service';
import { AuthController } from './controllers/authentication/authentication.controller';
import { UsersService } from '../users/services/users/users.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../typeorm/entities/user';
import { LocalStrategy } from '../utils/local.strategy';
import { SessionSerializer } from '../utils/session.serializer';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
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
