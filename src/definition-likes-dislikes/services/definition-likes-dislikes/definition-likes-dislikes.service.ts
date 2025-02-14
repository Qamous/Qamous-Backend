import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DefinitionLikeDislike } from '../../../typeorm/entities/definition-like-dislike';
import { User } from '../../../typeorm/entities/user';
import { CreateReactionDto } from '../../dtos/create-reaction.dto';
import { DefinitionsService } from '../../../definitions/services/definitions/definitions.service';
import { UpdateDefinitionDto } from '../../../definitions/dtos/update-definition.dto';
import { UsersService } from '../../../users/services/users/users.service';
import { UpdateUserDto } from '../../../users/dtos/update-user.dto';
import { Logger } from '@nestjs/common';

@Injectable()
export class DefinitionLikesDislikesService {
  constructor(
    @InjectRepository(DefinitionLikeDislike)
    private definitionLikesDislikesRepository: Repository<DefinitionLikeDislike>,
    private definitionsService: DefinitionsService, // Inject the DefinitionsService
    private usersService: UsersService, // Inject the UsersService
  ) {}
  private readonly logger = new Logger(DefinitionLikesDislikesService.name);

  async likeDefinition(user: User, definitionId: number) {
    const createReactionDto: CreateReactionDto = {
      definitionId: definitionId,
      userId: user.id,
      liked: true,
      createdAt: new Date(),
    };
    const like =
      this.definitionLikesDislikesRepository.create(createReactionDto);

    await this.definitionLikesDislikesRepository.save(like);
    // Increment the likeCount in the definitions table
    const definition = await this.definitionsService.getDefinitionById(
      definitionId,
      { relations: ['user'] },
    );

    await this.definitionsService.updateDefinitionReactionCounts(definitionId, {
      likeCount: definition.likeCount + 1,
    });

    // Increment the likesReceived for the user who created the definition
    this.logger.log(
      `Incrementing likesReceived for user ${definition.user.id}`,
    );
    const definitionUser = await this.usersService.findUserById(
      definition.user.id,
    );
    const updateUserDto: UpdateUserDto = {
      likesReceived: definitionUser.likesReceived + 1,
    };
    await this.usersService.updateUser(definitionUser.id, updateUserDto);
  }

  async dislikeDefinition(user: User, definitionId: number) {
    const createReactionDto: CreateReactionDto = {
      definitionId: definitionId,
      userId: user.id,
      liked: false, // Set liked to false for dislikes
      createdAt: new Date(),
    };
    const dislike =
      this.definitionLikesDislikesRepository.create(createReactionDto);

    await this.definitionLikesDislikesRepository.save(dislike);

    // Increment the dislikeCount in the definitions table
    const definition = await this.definitionsService.getDefinitionById(
      definitionId,
      { relations: ['user'] },
    );

    await this.definitionsService.updateDefinitionReactionCounts(definitionId, {
      dislikeCount: definition.dislikeCount + 1,
    });

    // Decrement the likesReceived for the user who created the definition
    this.logger.log(
      `Decrementing likesReceived for user ${definition.user.id}`,
    );
    const definitionUser = await this.usersService.findUserById(
      definition.user.id,
    );
    const updateUserDto: UpdateUserDto = {
      likesReceived: definitionUser.likesReceived - 1,
    };
    await this.usersService.updateUser(definitionUser.id, updateUserDto);
  }

  async unlikeDefinition(user: User, definitionId: number) {
    const like = await this.definitionLikesDislikesRepository.findOne({
      where: { definitionId, userId: user.id, liked: true },
    });

    if (!like) {
      throw new Error('Like not found');
    }

    await this.definitionLikesDislikesRepository.remove(like);

    const definition = await this.definitionsService.getDefinitionById(
      definitionId,
      { relations: ['user'] },
    );
    if (!definition.user) {
      throw new Error('User not found for the definition');
    }

    await this.definitionsService.updateDefinitionReactionCounts(definitionId, {
      likeCount: definition.likeCount - 1,
    });


    // Decrement the likesReceived for the user who created the definition
    this.logger.log(
      `Decrementing likesReceived for user ${definition.user.id}`,
    );
    const definitionUser = await this.usersService.findUserById(
      definition.user.id,
    );
    const updateUserDto: UpdateUserDto = {
      likesReceived: definitionUser.likesReceived - 1,
    };
    await this.usersService.updateUser(definitionUser.id, updateUserDto);
  }

  async undislikeDefinition(user: User, definitionId: number) {
    const dislike = await this.definitionLikesDislikesRepository.findOne({
      where: { definitionId, userId: user.id, liked: false },
    });

    if (!dislike) {
      throw new Error('Dislike not found');
    }

    await this.definitionLikesDislikesRepository.remove(dislike);

    const definition = await this.definitionsService.getDefinitionById(
      definitionId,
      { relations: ['user'] },
    );

    await this.definitionsService.updateDefinitionReactionCounts(definitionId, {
      dislikeCount: definition.dislikeCount - 1,
    });
    // Increment the likesReceived for the user who created the definition
    this.logger.log(
      `Incrementing likesReceived for user ${definition.user.id}`,
    );
    const definitionUser = await this.usersService.findUserById(
      definition.user.id,
    );
    const updateUserDto: UpdateUserDto = {
      likesReceived: definitionUser.likesReceived + 1,
    };
    await this.usersService.updateUser(definitionUser.id, updateUserDto);
  }

  async getLikesDislikes(definitionId: number) {
    return await this.definitionLikesDislikesRepository.find({
      where: { definitionId },
    });
  }

  async getLikes(definitionId: number) {
    return await this.definitionLikesDislikesRepository.count({
      where: { definitionId, liked: true },
    });
  }

  async getDislikes(definitionId: number) {
    return await this.definitionLikesDislikesRepository.count({
      where: { definitionId, liked: false },
    });
  }

  async removeLike(user: User, definitionId: number) {
    return await this.definitionLikesDislikesRepository.delete({
      definitionId,
      userId: user.id,
      liked: true,
    });
  }

  async removeDislike(user: User, definitionId: number) {
    return await this.definitionLikesDislikesRepository.delete({
      definitionId,
      userId: user.id,
      liked: false,
    });
  }
}
