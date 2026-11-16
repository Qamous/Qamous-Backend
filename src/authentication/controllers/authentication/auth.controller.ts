import {
  Controller,
  Request,
  Post,
  UseGuards,
  Get,
  Next,
  Res,
} from '@nestjs/common';
import { Request as ExpressRequest, Response, NextFunction } from 'express';
import { Session } from 'express-session';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedGuard, LocalAuthGuard } from '../../../utils/guards/local.guard';

@Controller('auth')
export class AuthController {
  @Get('health')
  check() {
    return { status: 'OK' };
  }

  /**
   * This is a POST request to /auth/login that logs in a user
   * and returns the user object
   *
   * @param {e.Request} req - the request object
   * @returns {Promise<Express.User>} - the user object
   */
  @Throttle({ default: { limit: 5, ttl: 300000 } }) // 5 requests per 5 minutes
  @UseGuards(LocalAuthGuard)
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
   * @returns {Promise<{message: string}>} - a message
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests per minute
  @UseGuards(AuthenticatedGuard)
  @Post('logout')
  async logout(
    @Request() req: ExpressRequest,
    @Res() res: Response,
    @Next() next: NextFunction,
  ): Promise<{ message: string }> {
    req.logout(function (err) {
      if (err) {
        return next(err);
      }

      // Clear the session cookie
      req.session = null;

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
  //@UseGuards(AuthenticatedGuard)
  @Throttle({ default: { limit: 2, ttl: 60000 } }) // 2 requests per minute
  @Get('session')
  async getAuthSession(
    @Request() req: ExpressRequest,
  ): Promise<{ session: Session; sessionId: string; authenticated: boolean }> {
    const session: Session = req.session;
    return {
      session: session,
      sessionId: session.id,
      authenticated: req.isAuthenticated(),
    };
  }
}
