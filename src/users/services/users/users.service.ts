import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../../../typeorm/entities/user';
import { Repository } from 'typeorm';
import { CreateUserParams } from '../../../utils/types';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private usersRepository: Repository<User>,
  ) {}

  findUsers(): string {
    return 'All users';
  }

  createUser(userDetails: CreateUserParams): Promise<User> {
    const newUser = this.usersRepository.create({
      ...userDetails,
      createdAt: new Date(),
    });
    return this.usersRepository.save(newUser);
  }
}
