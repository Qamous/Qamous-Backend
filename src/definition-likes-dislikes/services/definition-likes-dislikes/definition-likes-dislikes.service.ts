import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DefinitionLikeDislike } from '../../../typeorm/entities/definition-like-dislike';
import { User } from '../../../typeorm/entities/user';
import { CreateReactionDto } from '../../dtos/create-reaction.dto';

@Injectable()
export class DefinitionLikesDislikesService {
  constructor(
    @InjectRepository(DefinitionLikeDislike)
    private definitionLikesDislikesRepository: Repository<DefinitionLikeDislike>,
  ) {}

  async likeDefinition(user: User, definitionID: number) {
    const createReactionDto: CreateReactionDto = {
      definitionId: definitionID,
      userId: user.id,
      liked: true,
      createdAt: new Date(),
    };
    const like =
      this.definitionLikesDislikesRepository.create(createReactionDto);

    return await this.definitionLikesDislikesRepository.save(like);
  }

  async dislikeDefinition(user: User, definitionID: number) {
    const createReactionDto: CreateReactionDto = {
      definitionId: definitionID,
      userId: user.id,
      liked: true,
      createdAt: new Date(),
    };
    const dislike =
      this.definitionLikesDislikesRepository.create(createReactionDto);

    return await this.definitionLikesDislikesRepository.save(dislike);
  }

  async getLikesDislikes(definitionID: number) {
    return await this.definitionLikesDislikesRepository.find({
      where: { definitionID },
    });
  }

  async getLikes(definitionID: number) {
    return await this.definitionLikesDislikesRepository.count({
      where: { definitionID, liked: true },
    });
  }

  async getDislikes(definitionID: number) {
    return await this.definitionLikesDislikesRepository.count({
      where: { definitionID, liked: false },
    });
  }

  async removeLike(user: User, definitionID: number) {
    return await this.definitionLikesDislikesRepository.delete({
      definitionID,
      userID: user.id,
      liked: true,
    });
  }

  async removeDislike(user: User, definitionID: number) {
    return await this.definitionLikesDislikesRepository.delete({
      definitionID,
      userID: user.id,
      liked: false,
    });
  }
}
