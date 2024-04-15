import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as serveStatic from 'serve-static';
import * as cors from 'cors';
import process from 'process';
import * as session from 'express-session';
import * as passport from 'passport';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // TODO: update robots.txt and sitemap.xml once we have a domain and we're ready to go live
  app.use('/robots.txt', serveStatic('utils/robots.txt'));
  app.use('/sitemap.xml', serveStatic('utils/sitemap.xml'));
  app.use(cors({ origin: 'http://localhost:3001', credentials: true }));

  // Set up the session middleware
  app.use(
    session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: true,
        maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
      },
    }),
  );

  // Initialize and set up the Passport session middleware
  app.use(passport.initialize());
  app.use(passport.session());

  await app.listen(3000);
}

bootstrap();
