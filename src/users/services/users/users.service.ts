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
import { DefinitionsService } from '../../../definitions/services/definitions/definitions.service';
import { WordsService } from '../../../words/services/words/words.service';
import { UpdateWordDto } from '../../../words/dtos/update-word.dto';
import { Logger } from '@nestjs/common';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private usersRepository: Repository<User>,
    private readonly mailerService: MailerService,
    private readonly jwtService: JwtService,
    private readonly wordsService: WordsService,
    private readonly definitionsService: DefinitionsService,
  ) {}
  private readonly logger = new Logger(UsersService.name);

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
    this.logger.log(
      `Updating user ${id} with details: ${JSON.stringify(updateUserDetails)}`,
    );
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
   * This sets all of a user's posted words and definitions to user with id=7,
   * then deletes the user by their id.
   *
   * @param {number} id - the id of the user to delete
   * @returns {Promise<DeleteResult>} - the delete result
   */
  async deleteUser(id: number): Promise<DeleteResult> {
    const user: User = await this.usersRepository.findOne({ where: { id } });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    // Set all of the user's posted words and definitions to user with id=7
    const words = await this.wordsService.findByUserId(id);
    const definitions = await this.definitionsService.findByUserId(id);

    for (const word of words) {
      word.userId = 7;
      const updateWordDto: UpdateWordDto = {
        FrancoArabicWord: word.francoArabicWord,
        arabicWord: word.arabicWord,
        userId: 7,
      };
      await this.wordsService.updateWord(user, word.id, updateWordDto);
    }

    for (const definition of definitions) {
      definition.userId = 7;
      await this.definitionsService.updateDefinitionById(
        user,
        definition.id,
        definition,
      );
    }

    // Delete the user
    return await this.usersRepository.delete(id);
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
    const user: User = await this.usersRepository.findOne({
      where: { username },
    });
    if (user && (await verifyPassword(password, user.password))) {
      return plainToClass(User, user);
    }
    return null;
  }

  async resetPassword(email: string): Promise<void> {
    const user: User = await this.usersRepository.findOne({ where: { email } });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const payload = { userId: user.id };
    const token: string = this.jwtService.sign(payload, { expiresIn: '15m' });
    await this.sendPasswordResetEmail(email, token);
  }

  async updatePassword(token: string, newPassword: string): Promise<void> {
    let decodedToken: { userId: number };

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
    // TODO: make tokens expire when used

    const user: User = await this.usersRepository.findOne({
      where: { id: decodedToken.userId },
    });

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
    const url = `${process.env.REACT_APP_URL}`;
    await this.mailerService.sendMail({
      to: email, // list of receivers
      from: process.env.EMAIL_USERNAME, // sender address
      subject: 'Password Reset', // Subject line
      template: 'password-reset', // The name of the template file
      context: {
        // Data to be sent to template engine.
        url,
        token,
        email,
      },
    });
  }
}
