import { HttpException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../../../typeorm/entities/user';
import { DeleteResult, Repository, UpdateResult } from 'typeorm';
import { CreateUserParams, UpdateUserParams } from '../../../utils/types';
import { UpdateUserDto } from '../../dtos/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private usersRepository: Repository<User>,
  ) {}

  /*
   * This returns all users
   *
   * @returns {Promise<User[]>} - an array of all User objects
   */
  findUsers(): Promise<User[]> {
    return this.usersRepository.find();
  }

  /*
   * This creates a new user according to the details provided in the CreateUserParams object
   * and returns the newly created user
   *
   * @param {CreateUserParams} userDetails - the details of the new user
   * @returns {Promise<User>} - the newly created User object
   */
  createUser(userDetails: CreateUserParams): Promise<User> {
    const newUser = this.usersRepository.create({
      ...userDetails,
      createdAt: new Date(),
    });
    return this.usersRepository.save(newUser);
  }

  /*
   * This updates a user according to the details provided in the UpdateUserParams object
   * and returns the update result
   *
   * @param {number} id - the id of the user to update
   * @param {UpdateUserParams} updateUserDetails - the details of the user to update
   * @returns {Promise<UpdateResult>} - the update result
   */
  async updateUser(
    id: number,
    updateUserDetails: UpdateUserParams,
  ): Promise<UpdateResult> {
    const result = await this.usersRepository.update(
      { id },
      { ...updateUserDetails },
    );

    if (result.affected === 0) {
      throw new HttpException('User not found', 404);
    }

    return result;
  }

  /*
   * This deletes a user by their id
   *
   * @param {number} id - the id of the user to delete
   * @returns {Promise<DeleteResult>} - the delete result
   */
  async deleteUser(id: number): Promise<DeleteResult> {
    return this.usersRepository.delete({ id });
  }

  /*
   * This returns a user by their id
   *
   * @param {number} id - the id of the user to return
   * @returns {Promise<User>} - the User object with the specified id
   */
  async findUserById(id: number): Promise<User> {
    return this.usersRepository.findOne({
      where: { id },
    });
  }
}
