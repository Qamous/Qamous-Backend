import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as serveStatic from 'serve-static';
import * as cors from 'cors';
import process from 'process';
import * as session from 'express-session';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use('/robots.txt', serveStatic('utils/robots.txt'));
  app.use('/sitemap.xml', serveStatic('utils/sitemap.xml'));
  app.use(cors({ origin: 'http://localhost:3001', credentials: true }));

  // Set up the session middleware
  app.use(
    session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    }),
  );

  await app.listen(3000);
}
bootstrap();
