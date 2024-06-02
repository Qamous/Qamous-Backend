import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DefinitionLikeDislike } from '../../../typeorm/entities/definition-like-dislike';
import { User } from '../../../typeorm/entities/user';
import { CreateReactionDto } from '../../dtos/create-reaction.dto';
import { DefinitionsService } from '../../../definitions/services/definitions/definitions.service';
import { UpdateDefinitionDto } from '../../../definitions/dtos/update-definition.dto';

@Injectable()
export class DefinitionLikesDislikesService {
  constructor(
    @InjectRepository(DefinitionLikeDislike)
    private definitionLikesDislikesRepository: Repository<DefinitionLikeDislike>,
    private definitionsService: DefinitionsService, // Inject the DefinitionsService
  ) {}

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
    const definition =
      await this.definitionsService.getDefinitionById(definitionId);
    const updateDefinitionDto: UpdateDefinitionDto = {
      id: definition.id, // Change definitionId to id
      AddedTimestamp: definition.AddedTimestamp,
      likeCount: definition.likeCount + 1,
    };
    await this.definitionsService.updateDefinitionById(
      user,
      definitionId,
      updateDefinitionDto,
    );
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
    const definition =
      await this.definitionsService.getDefinitionById(definitionId);
    const updateDefinitionDto: UpdateDefinitionDto = {
      id: definition.id,
      AddedTimestamp: definition.AddedTimestamp,
      dislikeCount: definition.dislikeCount + 1,
    };
    await this.definitionsService.updateDefinitionById(
      user,
      definitionId,
      updateDefinitionDto,
    );
  }

  async unlikeDefinition(user: User, definitionId: number) {
    const like = await this.definitionLikesDislikesRepository.findOne({
      where: { definitionId, userId: user.id, liked: true },
    });

    if (!like) {
      throw new Error('Like not found');
    }

    await this.definitionLikesDislikesRepository.remove(like);

    const definition =
      await this.definitionsService.getDefinitionById(definitionId);
    const updateDefinitionDto: UpdateDefinitionDto = {
      id: definition.id,
      AddedTimestamp: definition.AddedTimestamp,
      likeCount: definition.likeCount - 1,
    };
    await this.definitionsService.updateDefinitionById(
      user,
      definitionId,
      updateDefinitionDto,
    );
  }

  async undislikeDefinition(user: User, definitionId: number) {
    const dislike = await this.definitionLikesDislikesRepository.findOne({
      where: { definitionId, userId: user.id, liked: false },
    });

    if (!dislike) {
      throw new Error('Dislike not found');
    }

    await this.definitionLikesDislikesRepository.remove(dislike);

    const definition =
      await this.definitionsService.getDefinitionById(definitionId);
    const updateDefinitionDto: UpdateDefinitionDto = {
      id: definition.id,
      AddedTimestamp: definition.AddedTimestamp,
      dislikeCount: definition.dislikeCount - 1,
    };
    await this.definitionsService.updateDefinitionById(
      user,
      definitionId,
      updateDefinitionDto,
    );
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
