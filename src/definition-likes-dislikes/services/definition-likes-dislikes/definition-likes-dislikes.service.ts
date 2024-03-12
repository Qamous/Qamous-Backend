import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DefinitionLikeDislike } from '../../../typeorm/entities/definition-like-dislike';

@Injectable()
export class DefinitionLikesDislikesService {
  constructor(
    @InjectRepository(DefinitionLikeDislike)
    private definitionLikesDislikesRepository: Repository<DefinitionLikeDislike>,
  ) {}

  async likeDefinition(definitionID: string, userID: string) {
    const like = this.definitionLikesDislikesRepository.create({
      definitionID,
      userID,
      liked: true,
    });

    return await this.definitionLikesDislikesRepository.save(like);
  }

  async dislikeDefinition(definitionID: string, userID: string) {
    const dislike = this.definitionLikesDislikesRepository.create({
      definitionID,
      userID,
      liked: false,
    });

    return await this.definitionLikesDislikesRepository.save(dislike);
  }

  async getLikesDislikes(definitionID: string) {
    return await this.definitionLikesDislikesRepository.find({
      where: { definitionID },
    });
  }

  async getLikes(definitionID: string) {
    return await this.definitionLikesDislikesRepository.count({
      where: { definitionID, liked: true },
    });
  }

  async getDislikes(definitionID: string) {
    return await this.definitionLikesDislikesRepository.count({
      where: { definitionID, liked: false },
    });
  }

  async removeLike(definitionID: string, userID: string) {
    return await this.definitionLikesDislikesRepository.delete({
      definitionID,
      userID,
      liked: true,
    });
  }

  async removeDislike(definitionID: string, userID: string) {
    return await this.definitionLikesDislikesRepository.delete({
      definitionID,
      userID,
      liked: false,
    });
  }
}
