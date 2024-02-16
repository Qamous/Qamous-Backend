import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreateUserDto } from '../dtos/create-user.dto';
import { UsersService } from '../../services/users/users.service';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  getUsers(): string {
    return 'All users';
  }

  @Post()
  createUser(@Body() createUserDto: CreateUserDto) {
    const { passwordConfirmation, ...userDetails } = createUserDto;
    if (passwordConfirmation !== userDetails.password) {
      throw new Error('Password confirmation does not match password');
    }
    this.usersService.createUser(userDetails);
  }
}
