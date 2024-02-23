import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../../../typeorm/entities/user';
import { Repository, UpdateResult } from 'typeorm';
import { CreateUserParams, UpdateUserParams } from '../../../utils/types';
import { UpdateUserDto } from '../../controllers/dtos/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private usersRepository: Repository<User>,
  ) {}

  findUsers(): Promise<User[]> {
    return this.usersRepository.find();
  }

  createUser(userDetails: CreateUserParams): Promise<User> {
    const newUser = this.usersRepository.create({
      ...userDetails,
      createdAt: new Date(),
    });
    return this.usersRepository.save(newUser);
  }

  updateUser(
    id: number,
    updateUserDetails: Omit<UpdateUserDto, 'passwordConfirmation'>,
  ): Promise<UpdateResult> {
    return this.usersRepository.update({ id }, { ...updateUserDetails });
  }

  async deleteUser(id: number) {
    return this.usersRepository.delete({ id });
  }
}
