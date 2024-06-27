import * as express from 'express';

declare global {
  namespace Express {
    interface Request {
      logout(callback: (err: any) => void): void;
    }
  }
}
