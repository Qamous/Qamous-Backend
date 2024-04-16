import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as dotenv from 'dotenv';
import * as process from 'process';
import { User } from './typeorm/entities/user';
import { UsersModule } from './users/users.module';
import { Country } from './typeorm/entities/country';
import { WordsModule } from './words/words.module';
import { DefinitionsModule } from './definitions/definitions.module';
import { CountriesModule } from './countries/countries.module';
import { DefinitionLikesDislikesModule } from './definition-likes-dislikes/definition-likes-dislikes.module';
import { WordReportsModule } from './word-reports/word-reports.module';
import { Word } from './typeorm/entities/word';
import { Definition } from './typeorm/entities/definition';
import { DefinitionLikeDislike } from './typeorm/entities/definition-like-dislike';
import { WordReport } from './typeorm/entities/word-report';
import { PassportModule } from '@nestjs/passport';
//import { LocalStrategy } from './local.strategy';
import { AuthenticationController } from './authentication/controllers/authentication/authentication.controller';

dotenv.config({ path: './safe/.env' });

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.HOST,
      port: parseInt(process.env.PORT),
      username: process.env.USER,
      password: process.env.PASSWORD,
      database: process.env.DATABASE,
      entities: [
        User,
        Country,
        Word,
        Definition,
        DefinitionLikeDislike,
        WordReport,
      ],
      synchronize: true,
    }),
    PassportModule,
    UsersModule,
    CountriesModule,
    WordsModule,
    DefinitionsModule,
    DefinitionLikesDislikesModule,
    WordReportsModule,
  ],
  controllers: [AppController, AuthenticationController],
  providers: [AppService], // add LocalStrategy
})
export class AppModule {}
