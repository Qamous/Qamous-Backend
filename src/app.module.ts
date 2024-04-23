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
import { AuthController } from './authentication/controllers/authentication/auth.controller';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './authentication/auth.module';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';

dotenv.config({ path: './safe/.env' });

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 60 seconds
        limit: 10, // limit each IP to 10 requests per ttl
      },
    ]),
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
    MailerModule.forRoot({
      transport: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false, // upgrade later with STARTTLS
        auth: {
          user: process.env.EMAIL_USERNAME,
          pass: process.env.EMAIL_PASSWORD,
        },
      },
      defaults: {
        from: '"nest-modules" <modules@nestjs.com>',
      },
      template: {
        dir: __dirname + '/templates',
        adapter: new HandlebarsAdapter(),
        options: {
          strict: true,
        },
      },
    }),
    PassportModule.register({ session: true }),
    UsersModule,
    CountriesModule,
    WordsModule,
    DefinitionsModule,
    DefinitionLikesDislikesModule,
    WordReportsModule,
    AuthModule,
  ],
  controllers: [AppController, AuthController],
  providers: [AppService],
})
export class AppModule {}
