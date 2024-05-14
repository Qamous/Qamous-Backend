import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as serveStatic from 'serve-static';
import * as cors from 'cors';
import * as session from 'express-session';
import * as passport from 'passport';
import { v4 as uuidV4 } from 'uuid';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // TODO: update robots.txt and sitemap.xml once we have a domain and we're ready to go live
  app.use('/robots.txt', serveStatic('utils/robots.txt'));
  app.use('/sitemap.xml', serveStatic('utils/sitemap.xml'));
  app.use(cors({ origin: 'http://localhost:3001', credentials: true }));

  const mySqlStore = require('express-mysql-session')(session);
  // TODO: Should I switch to a TypeORM store (https://www.youtube.com/watch?v=7DEByCGk4rQ&list=PL_cUvD4qzbkw-phjGK2qq0nQiG6gw1cKK&index=22&ab_channel=AnsontheDeveloper)?
  const APP_PORT = process.env.APP_PORT || 3000;
  const IN_PROD: boolean = process.env.NODE_ENV === 'production';
  const TEN_MINUTES: number = 1000 * 60 * 10;

  const options = {
    connectionLimit: 10,
    host: process.env.HOST,
    port: parseInt(process.env.PORT), // db port
    user: process.env.USER,
    password: process.env.PASSWORD,
    database: process.env.DATABASE,
    createDatabaseTable: true,
  };

  const sessionStore = new mySqlStore(options);

  // Set up the session middleware
  app.use(
    session({
      name: process.env.SESS_NAME,
      genid: function () {
        return uuidV4();
      },
      secret: process.env.SESS_SECRET,
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: {
        httpOnly: true,
        secure: IN_PROD, // TODO: require HTTPS in production
        maxAge: TEN_MINUTES,
        sameSite: 'lax', // TODO: SameSite is 'lax' or 'strict' for local testing, do the research for production
      },
      rolling: true, // Reset the maxAge on every request
    }),
  );

  // Initialize and set up the Passport session middleware
  app.use(passport.initialize());
  app.use(passport.session());

  // TODO: should I add Helmet?
  await app.listen(APP_PORT);
}

bootstrap().catch((err) => console.error(err));
