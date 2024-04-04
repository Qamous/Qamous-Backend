import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as serveStatic from 'serve-static';
import * as cors from 'cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use('/robots.txt', serveStatic('utils/robots.txt'));
  app.use('/sitemap.xml', serveStatic('utils/sitemap.xml'));
  app.use(cors({ origin: 'http://localhost:3001', credentials: true }));
  await app.listen(3000);
}
bootstrap();
