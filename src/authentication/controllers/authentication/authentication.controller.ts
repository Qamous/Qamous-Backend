import { Controller, Request, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request as ExpressRequest, Response, NextFunction } from 'express';

@Controller('auth')
export class AuthController {
  @UseGuards(AuthGuard('local'))
  @Post('login')
  async login(@Request() req: ExpressRequest) {
    // Passport automatically attaches user to the request object
    return req.user;
  }

  @UseGuards(AuthGuard('local'))
  @Post('logout')
  async logout(
    @Request() req: ExpressRequest,
    res: Response,
    next: NextFunction,
  ) {
    req.logout(function (err) {
      if (err) {
        return next(err);
      }
      res.redirect('/');
    });
    return { message: 'Logged out successfully' };
  }
}
