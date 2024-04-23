import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../../../typeorm/entities/user';
import { DeleteResult, Repository, UpdateResult } from 'typeorm';
import { CreateUserParams, UpdateUserParams } from '../../../utils/types';
import {
  newPasswordHashing,
  verifyPassword,
} from '../../../../safe/new-password-hashing';
import { plainToClass } from 'class-transformer';
import { randomBytes } from 'crypto';
import { MailerService } from '@nestjs-modules/mailer';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private usersRepository: Repository<User>,
    private mailerService: MailerService,
    private jwtService: JwtService,
  ) {}

  /**
   * This returns all users
   *
   * @returns {Promise<User[]>} - an array of all User objects
   */
  async findUsers(): Promise<User[]> {
    return await this.usersRepository.find();
  }

  /**
   * This creates a new user according to the details provided in the CreateUserParams object
   * and returns the newly created user
   *
   * @param {CreateUserParams} userDetails - the details of the new user
   * @returns {Promise<User>} - the newly created User object
   */
  async createUser(userDetails: CreateUserParams): Promise<User> {
    const hashedPassword = newPasswordHashing(userDetails.password);
    const newUser = this.usersRepository.create({
      password: hashedPassword,
      ...userDetails,
      createdAt: new Date(),
    });

    return await this.usersRepository.save(newUser);
  }

  /**
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
    // updateUserDetails.password = await newPasswordHashing(
    //   updateUserDetails.password,
    // );
    const result = await this.usersRepository.update(
      { id },
      { ...updateUserDetails },
    );

    if (result.affected === 0) {
      throw new HttpException('User not found', 404);
    }

    return result;
  }

  /**
   * This deletes a user by their id
   *
   * @param {number} id - the id of the user to delete
   * @returns {Promise<DeleteResult>} - the delete result
   */
  async deleteUser(id: number): Promise<DeleteResult> {
    return this.usersRepository.delete({ id });
  }

  /**
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

  /**
   * This validates a user by their username and password and returns the user if they are valid.
   *
   * @param {string} username - the username of the user to validate
   * @param {string} password - the password of the user to validate
   * @returns {Promise<User>} - the User object if the user is valid, otherwise null
   */
  async validateUser(username: string, password: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { username } });
    if (user && (await verifyPassword(password, user.password))) {
      return plainToClass(User, user);
    }
    return null;
  }

  async resetPassword(email: string): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { email } });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const payload = { userId: user.id };
    const token = this.jwtService.sign(payload, { expiresIn: '1h' });

    await this.sendPasswordResetEmail(email, token);
  }

  async updatePassword(token: string, newPassword: string): Promise<void> {
    let decodedToken;

    try {
      decodedToken = this.jwtService.verify(token);
    } catch (err) {
      throw new HttpException(
        'Invalid or expired token',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!decodedToken) {
      throw new HttpException(
        'Invalid or expired token',
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = await this.usersRepository.findOne(decodedToken.userId);

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    user.password = await newPasswordHashing(newPassword);

    await this.usersRepository.save(user);
  }

  private generateResetToken(): string {
    return randomBytes(20).toString('hex');
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    await this.mailerService.sendMail({
      to: email, // list of receivers
      from: process.env.EMAIL_USERNAME, // sender address
      subject: 'Password Reset', // Subject line
      template: 'password-reset', // The name of the template file
      context: {
        // Data to be sent to template engine.
        token,
        email,
      },
    });
  }
}
