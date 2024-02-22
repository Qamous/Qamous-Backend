import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreateUserDto } from '../dtos/create-user.dto';
import { UsersService } from '../../services/users/users.service';
import { User } from '../../../typeorm/entities/user';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  /*
   * This is a GET request to /users that returns all users
   *
   * @returns {Promise<User[]>} - an array of User objects
   */
  @Get()
  async getUsers(): Promise<User[]> {
    return await this.usersService.findUsers();
  }

  /*
   * This is a POST request to /users that creates a new user
   *
   * @param {CreateUserDto} createUserDto - a CreateUserDto object that contains the details of the new user
   * @returns {Promise<User>} - the newly created User object
   */
  @Post()
  createUser(@Body() createUserDto: CreateUserDto) {
    const { passwordConfirmation, ...userDetails } = createUserDto;
    if (passwordConfirmation !== userDetails.password) {
      throw new Error('Password confirmation does not match password');
    }
    return this.usersService.createUser(userDetails);
  }
}
