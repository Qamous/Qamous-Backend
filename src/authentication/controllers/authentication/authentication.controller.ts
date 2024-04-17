import { Controller, Request, Post, UseGuards, Get } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request as ExpressRequest, Response, NextFunction } from 'express';
import { Session } from 'express-session';

@Controller('auth')
export class AuthController {
  /**
   * This is a POST request to /auth/login that logs in a user
   * and returns the user object
   *
   * @param {e.Request} req - the request object
   * @returns {Promise<Express.User>} - the user object
   */
  @UseGuards(AuthGuard('local'))
  @Post('login')
  async login(@Request() req: ExpressRequest): Promise<Express.User> {
    // Passport automatically attaches user to the request object
    return req.user;
  }

  /**
   * This is a POST request to /auth/logout that logs out a user
   * and returns a message
   *
   * @param {e.Request} req - the request object
   * @param {e.Response} res - the response object
   * @param {e.NextFunction} next - the next function
   * @returns {Promise<{ message: string }>} - a message object
   */
  @UseGuards(AuthGuard('local'))
  @Post('logout')
  async logout(
    @Request() req: ExpressRequest,
    res: Response,
    next: NextFunction,
  ): Promise<{ message: string }> {
    req.logout(function (err) {
      if (err) {
        return next(err);
      }
      res.redirect('/');
    });
    return { message: 'Logged out successfully' };
  }

  /**
   * This is a GET request to /auth/session that returns the session
   * and the session id.
   *
   * @param {e.Request} req - the request object
   * @returns {Promise<{session: session.Session, sessionId: string}>} - the session and the session id
   */
  @Get('session')
  async getAuthSession(
    @Request() req: ExpressRequest,
  ): Promise<{ session: Session; sessionId: string }> {
    const session: Session = req.session;
    return {
      session: session,
      sessionId: session.id,
    };
  }
}
