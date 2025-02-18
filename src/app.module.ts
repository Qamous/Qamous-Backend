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
import { DefinitionReportsController } from './definition-reports/controllers/definition-reports/definition-reports.controller';
import { DefinitionReportsModule } from './definition-reports/definition-reports.module';
import { DefinitionReport } from './typeorm/entities/definition-report';
import { RagModule } from './rag/rag.module';
import { ModelService } from './rag/services/model/model.service';
import { VectorStoreService } from './rag/services/vector-store/vector-store.service';

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
      connectorPackage: 'mysql2',
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
        DefinitionReport,
      ],
      synchronize: true,
    }),
    MailerModule.forRootAsync({
      useFactory: () => ({
        transport: {
          host: 'smtp.gmail.com',
          port: 587,
          secure: false, // TODO: upgrade later with STARTTLS
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
            strict: false,
          },
        },
      }),
    }),
    PassportModule.register({ session: true }),
    UsersModule,
    CountriesModule,
    WordsModule,
    DefinitionsModule,
    DefinitionLikesDislikesModule,
    WordReportsModule,
    AuthModule,
    DefinitionReportsModule,
    RagModule,
  ],
  controllers: [AppController, AuthController, DefinitionReportsController],
  providers: [AppService, ModelService],
})
export class AppModule {}
