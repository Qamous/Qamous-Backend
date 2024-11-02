import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    console.log(`Incoming Request: ${req.method} ${req.url}`);
    console.log('Request Headers:', req.headers);
    console.log('Request Body:', req.body);

    const originalSend = res.send;
    res.send = function (body) {
      console.log('Response Status Code:', res.statusCode);
      res.send = originalSend; // reset to avoid infinite loop
      return res.send(body);
    };

    next();
  }
}
