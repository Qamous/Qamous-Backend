import { AuthGuard } from '@nestjs/passport';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const result = (await super.canActivate(context)) as boolean;
    const request = context.switchToHttp().getRequest();
    await super.logIn(request);
    return result;
  }
}

@Injectable()
export class AuthenticatedGuard implements CanActivate {
  private readonly logger: Logger = new Logger(AuthenticatedGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const isAuthenticated = request.isAuthenticated();
    const user = request.user;
    if (!isAuthenticated || !user) {
      this.logger.warn(`User object is missing in the request`);
      throw new UnauthorizedException('User not authenticated properly');
    }
    this.logger.log(`User authenticated: ${isAuthenticated}`);
    this.logger.log(`Request headers: ${JSON.stringify(request.headers)}`);
    this.logger.log(`Request user: ${JSON.stringify(request.user)}`);
    this.logger.log(`Session: ${JSON.stringify(request.session)}`);
    return isAuthenticated;
  }
}

/*
export class JwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const result = (await super.canActivate(context)) as boolean;
    return result;
  }
}

export class JwtRefreshGuard extends AuthGuard('jwt-refresh-token') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const result = (await super.canActivate(context)) as boolean;
    return result;
  }
}
*/
