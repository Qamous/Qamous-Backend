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
  Post, Req, UseGuards
} from "@nestjs/common";
import { CreateUserDto } from '../../dtos/create-user.dto';
import { UsersService } from '../../services/users/users.service';
import { User } from '../../../typeorm/entities/user';
import { UpdateUserDto } from '../../dtos/update-user.dto';
import { DeleteResult, UpdateResult } from 'typeorm';
import {
  newPasswordHashing,
  verifyPassword,
} from '../../../../safe/new-password-hashing';
import { validateFields } from '../../utils/validation';
import { plainToClass } from 'class-transformer';
import { AuthenticatedGuard } from "../../../utils/guards/local.guard";
import { UserRequest } from "../../../utils/types";
import { Throttle } from "@nestjs/throttler";

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  /**
   * This is a GET request to /users that returns all users (serialized)
   *
   * @returns {Promise<User[]>} - an array of User objects
   */
  @Get()
  async getUsers(): Promise<User[]> {
    const users: User[] = await this.usersService.findUsers();
    return users.map((user) => plainToClass(User, user));
  }

  /**
   * This is a GET request to /users/:id that returns a (serialized) user by their id
   *
   * @param {number} id - the id of the user to return
   * @returns {Promise<User>} - the User object with the specified id
   */
  @Get(':id')
  async getUserById(@Param('id', ParseIntPipe) id: number): Promise<User> {
    const user: User = await this.usersService.findUserById(id);
    return plainToClass(User, user);
  }

  /**
   * This is a POST request to /users that creates a new user
   *
   * @param {CreateUserDto} createUserDto - a CreateUserDto object that contains the details of the new user
   * @returns {Promise<User>} - the newly created User object (serialized)
   */
  @Post('register')
  async createUser(@Body() createUserDto: CreateUserDto): Promise<User> {
    // TODO: on the front end, make sure to protect from sql injection
    // validation
    this.httpValidateFields(createUserDto);

    const { passwordConfirmation, ...userDetails } = createUserDto;
    this.passwordConfirmation(passwordConfirmation, userDetails.password);
    userDetails.password = await newPasswordHashing(userDetails.password);
    const user: User = await this.usersService.createUser(userDetails);
    return plainToClass(User, user);
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
    // remove the old password from the object
    delete updateUserDto.oldPassword;
    // validation
    this.httpValidateFields(updateUserDto);
    // if the password is being updated, verify the password confirmation
    const { passwordConfirmation, ...newUserDetails } = updateUserDto;
    this.passwordConfirmation(passwordConfirmation, newUserDetails.password);
    newUserDetails.password = await newPasswordHashing(newUserDetails.password);
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
      if (!(await verifyPassword(updateUserDto.oldPassword, user.password))) {
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

  /**
   * This is a POST request to /users/reset-password that sends a reset password email
   *
   * @param {string} email - the email of the user to reset the password for
   * @returns {Promise<void>}
   */
  @Post('reset-password')
  async resetPassword(@Body('email') email: string): Promise<void> {
    return this.usersService.resetPassword(email);
  }

  /**
   * This is a POST request to /users/reset-password/:token that updates the password of a user
   *
   * @param {string} token - the token of the user to update the password for
   * @param {string} newPassword - the new password
   * @returns {Promise<void>}
   */
  @Post('reset-password/:token')
  async updatePassword(
    @Param('token') token: string,
    @Body('newPassword') newPassword: string,
  ): Promise<void> {
    return this.usersService.updatePassword(token, newPassword);
  }

  /**
   * This is a POST request to /users/recalculate-points that recalculates all users' points
   *
   * @returns {Promise<{ message: string }>} - a message indicating that the points were recalculated successfully
   */
  @UseGuards(AuthenticatedGuard)
  // TODO: @Throttle({ default: { limit: 2, ttl: 60000 } })
  @Post('recalculate-points')
  async recalculatePoints(): Promise<{ message: string }> { // TODO: Add appropriate guards
    await this.usersService.recalculateAllUsersPoints();
    return { message: 'Points recalculated successfully' };
  }

  /**
   * This is a GET request to /users/me/points that returns the points of the authenticated user
   * @param req - the request object
   * @returns {Promise<{ points: number }>} - an object containing the points of the authenticated user
   */
  @UseGuards(AuthenticatedGuard)
  @Get('me/points')
  async getUserPoints(@Req() req: UserRequest): Promise<{ points: number }> {
    const user = await this.usersService.findUserById(req.user.id);
    return { points: user.points };
  }

  /**
   * This is a GET request to /users/:id/points that returns the points of a user by their id
   * @param id - the id of the user to return the points for
   * @returns {Promise<{ points: number }>} - an object containing the points of the user
   */
  @Get(':id/points')
  async getPointsById(@Param('id', ParseIntPipe) id: number): Promise<{ points: number }> {
    const user = await this.usersService.findUserById(id);
    return { points: user.points };
  }

}
