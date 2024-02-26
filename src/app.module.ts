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

dotenv.config();

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.HOST,
      port: parseInt(process.env.PORT),
      username: process.env.USER,
      password: process.env.PASSWORD,
      database: process.env.DATABASE,
      entities: [User, Country],
      synchronize: true,
    }),
    UsersModule,
    CountriesModule,
    WordsModule,
    DefinitionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
