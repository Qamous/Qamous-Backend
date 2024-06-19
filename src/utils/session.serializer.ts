import { PassportSerializer } from '@nestjs/passport';
import { UsersService } from '../users/services/users/users.service';
import { User } from '../typeorm/entities/user';
import { Injectable } from '@nestjs/common';

@Injectable()
export class SessionSerializer extends PassportSerializer {
  constructor(private readonly usersService: UsersService) {
    super();
  }

  serializeUser(user: User, done: (err: Error, user: User) => void) {
    done(null, user);
  }

  async deserializeUser(
    sessionUser: User,
    done: (err: Error, user: User) => void,
  ) {
    const user = await this.usersService.findUserById(sessionUser.id);
    return user ? done(null, user) : done(null, null);
  }
}
