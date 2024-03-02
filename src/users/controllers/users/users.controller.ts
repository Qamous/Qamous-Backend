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
import { DeleteResult, UpdateResult } from 'typeorm';
import { verifyPassword } from '../../../../safe/new-password-hashing';
import { validateFields } from '../../utils/validation';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  /**
   * This is a GET request to /users that returns all users
   *
   * @returns {Promise<User[]>} - an array of User objects
   */
  @Get()
  async getUsers(): Promise<User[]> {
    return await this.usersService.findUsers();
  }

  /**
   * This is a GET request to /users/:id that returns a user by their id
   *
   * @param {number} id - the id of the user to return
   * @returns {Promise<User>} - the User object with the specified id
   */
  @Get(':id')
  async getUserById(@Param('id', ParseIntPipe) id: number): Promise<User> {
    return await this.usersService.findUserById(id);
  }

  /**
   * This is a POST request to /users that creates a new user
   *
   * @param {CreateUserDto} createUserDto - a CreateUserDto object that contains the details of the new user
   * @returns {Promise<User>} - the newly created User object
   */
  @Post('register')
  async createUser(@Body() createUserDto: CreateUserDto): Promise<User> {
    // TODO: on the front end, make sure to protect from sql injection
    // validation
    this.httpValidateFields(createUserDto);

    const { passwordConfirmation, ...userDetails } = createUserDto;
    this.passwordConfirmation(passwordConfirmation, userDetails.password);
    return await this.usersService.createUser(userDetails);
  }

  /**
   * This is a PATCH request to /users/:id that updates a user by their id
   *
   * @param {number} id - the id of the user to update
   * @param {UpdateUserDto} updateUserDto - an UpdateUserDto object that contains the details of the user to update
   * @returns {Promise<UpdateResult>} - the update result
   */
  @Patch(':id')
  async updateUserById(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<UpdateResult> {
    // TODO: on the front end, make sure to protect from sql injection
    // make sure old password is correct
    await this.verifyOldPassword(id, updateUserDto);
    // validation
    this.httpValidateFields(updateUserDto);
    // remove the old password from the object
    delete updateUserDto.oldPassword;
    // if the password is being updated, verify the password confirmation
    const { passwordConfirmation, ...newUserDetails } = updateUserDto;
    this.passwordConfirmation(passwordConfirmation, newUserDetails.password);
    return await this.usersService.updateUser(id, newUserDetails);
  }

  /**
   * This is a helper function that validates the fields of a user and throws an http error if they are invalid.
   * It is used in the createUser and updateUserById methods.
   *
   * @param {CreateUserDto | UpdateUserDto} userDto - the fields of the user to validate
   * @returns {void} - nothing
   * @private
   */
  private httpValidateFields(userDto: CreateUserDto | UpdateUserDto): void {
    try {
      validateFields(userDto);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * This is a helper function that verifies the password confirmation and throws an error if it is incorrect only if the password is being updated.
   * It is used in the createUser and updateUserById methods.
   *
   * @param {string} passwordConfirmation - the password confirmation to verify
   * @param {string} password - the password to compare the password confirmation to
   * @returns {void} - nothing
   * @private
   */
  private passwordConfirmation(
    passwordConfirmation: string,
    password: string,
  ): void {
    if (
      (passwordConfirmation || password) &&
      passwordConfirmation !== password
    ) {
      throw new HttpException(
        'Password confirmation does not match password',
        HttpStatus.BAD_REQUEST,
      );
    }
    return;
  }

  /**
   * This is a helper function that verifies the old password and throws an error if it is incorrect or missing.
   * It is used in the updateUserById method.
   *
   * @param {number} id - the id of the user to update
   * @param {UpdateUserDto} updateUserDto - an UpdateUserDto object that contains the details of the user to update
   * @returns {Promise<void>} - nothing
   * @private
   */
  private async verifyOldPassword(
    id: number,
    updateUserDto: UpdateUserDto,
  ): Promise<void> {
    if (updateUserDto.oldPassword) {
      const user: User = await this.usersService.findUserById(id);
      // if old password is incorrect, throw an error
      if (
        !verifyPassword(
          user.hashedPassword,
          updateUserDto.oldPassword,
          user.salt,
        )
      ) {
        throw new HttpException(
          'Old password is incorrect',
          HttpStatus.BAD_REQUEST,
        );
      } else {
        return;
      }
    } else {
      throw new HttpException(
        'Old password is required',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * This is a DELETE request to /users/:id that deletes a user by their id
   *
   * @param {number} id - the id of the user to delete
   * @returns {Promise<DeleteResult>} - the delete result
   */
  @Delete(':id')
  async deleteUserById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<DeleteResult> {
    return await this.usersService.deleteUser(id);
  }
}
