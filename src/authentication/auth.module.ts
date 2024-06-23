import { Module } from '@nestjs/common';
import { AuthService } from './services/authentication/auth.service';
import { AuthController } from './controllers/authentication/auth.controller';
import { UsersService } from '../users/services/users/users.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../typeorm/entities/user';
import { LocalStrategy } from '../utils/local.strategy';
import { SessionSerializer } from '../utils/session.serializer';
import { JwtModule } from '@nestjs/jwt';
import { WordsService } from '../words/services/words/words.service';
import { DefinitionsService } from '../definitions/services/definitions/definitions.service';
import { Word } from '../typeorm/entities/word';
import { Definition } from '../typeorm/entities/definition';
import { Country } from '../typeorm/entities/country';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Word, Country, Definition]),
    JwtModule,
  ],
  controllers: [AuthController],
  providers: [
    {
      provide: 'AUTH_SERVICE',
      useClass: AuthService,
    },
    UsersService,
    WordsService,
    DefinitionsService,
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
