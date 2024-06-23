import { Module } from '@nestjs/common';
import { UsersController } from './controllers/users/users.controller';
import { UsersService } from './services/users/users.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../typeorm/entities/user';
import { JwtModule } from '@nestjs/jwt';
import { WordsService } from '../words/services/words/words.service';
import { DefinitionsService } from '../definitions/services/definitions/definitions.service';
import { Word } from '../typeorm/entities/word';
import { Country } from '../typeorm/entities/country';
import { Definition } from '../typeorm/entities/definition';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Word, Country, Definition]),
    JwtModule.register({
      secret: 'process.env.JWT_SECRET', // TODO: fix this
      signOptions: { expiresIn: '600s' },
    }),
  ],
  controllers: [UsersController],
  providers: [UsersService, WordsService, DefinitionsService],
  exports: [UsersService],
})
export class UsersModule {}
