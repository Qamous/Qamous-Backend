import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { CreateUserDto } from '../dtos/create-user.dto';
import { UsersService } from '../../services/users/users.service';
import { User } from '../../../typeorm/entities/user';
import { UpdateUserDto } from '../dtos/update-user.dto';

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
   * This is a PUT request to /users/:id that updates a user by their id
   *
   * @param {number} id - the id of the user to update
   * @param {UpdateUserDto} updateUserDto - an UpdateUserDto object that contains the details of the user to update
   * @returns {Promise<void>} - a Promise that resolves to void
   */
  @Put(':id')
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
}
