import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../../../users/services/users/users.service';
import { User } from '../../../typeorm/entities/user';

@Injectable()
export class AuthService {
  constructor(private readonly userService: UsersService) {}

  async validateUser(username: string, password: string): Promise<User> {
    const user: User = await this.userService.validateUser(username, password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return user;
  }
}
