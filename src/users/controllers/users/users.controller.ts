import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CreateUserDto } from '../../dtos/create-user.dto';
import { UsersService } from '../../services/users/users.service';
import { User } from '../../../typeorm/entities/user';
import { UpdateUserDto } from '../../dtos/update-user.dto';

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

  @Get(':id')
  async getUserById(@Param('id', ParseIntPipe) id: number): Promise<User> {
    return await this.usersService.findUserById(id);
  }

  /*
   * This is a POST request to /users that creates a new user
   *
   * @param {CreateUserDto} createUserDto - a CreateUserDto object that contains the details of the new user
   * @returns {Promise<User>} - the newly created User object
   */
  @Post('register')
  createUser(@Body() createUserDto: CreateUserDto): Promise<User> {
    // TODO: add validation for password and other fields
    const { passwordConfirmation, ...userDetails } = createUserDto;
    if (passwordConfirmation !== userDetails.password) {
      throw new HttpException(
        'Password confirmation does not match password',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.usersService.createUser(userDetails);
  }

  /*
   * This is a PATCH request to /users/:id that updates a user by their id
   *
   * @param {number} id - the id of the user to update
   * @param {UpdateUserDto} updateUserDto - an UpdateUserDto object that contains the details of the user to update
   * @returns {Promise<void>} - a Promise that resolves to void
   */
  @Patch(':id')
  async updateUserById(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<void> {
    // TODO: add validation for password and other fields
    const { passwordConfirmation, ...newUserDetails } = updateUserDto;
    if (passwordConfirmation !== newUserDetails.password) {
      throw new HttpException(
        'Password confirmation does not match password',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.usersService.updateUser(id, newUserDetails);
  }

  @Delete(':id')
  async deleteUserById(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.usersService.deleteUser(id);
  }
}
