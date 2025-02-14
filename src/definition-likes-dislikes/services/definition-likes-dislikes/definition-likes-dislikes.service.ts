import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException
} from "@nestjs/common";
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
import { Definition } from "../../../typeorm/entities/definition";

@Injectable()
export class DefinitionLikesDislikesService {
  private readonly logger = new Logger(DefinitionLikesDislikesService.name);

  constructor(
    @InjectRepository(DefinitionLikeDislike)
    private definitionLikesDislikesRepository: Repository<DefinitionLikeDislike>,
    private definitionsService: DefinitionsService,

  ) {}

  private async validateReactionRequest(user: User, definitionId: number) {
    // Check if user exists and is active
    if (!user || !user.id) {
      throw new UnauthorizedException('User must be authenticated');
    }

    // Get definition with author information
    const definition = await this.definitionsService.getDefinitionById(
      definitionId,
      { relations: ['user'] }
    );

    // Check if definition exists
    if (!definition) {
      throw new NotFoundException(`Definition ${definitionId} not found`);
    }

    // Prevent self-reactions
    if (definition.userId === user.id) {
      throw new ConflictException('Cannot react to your own definition');
    }

    return definition;
  }

  async handleReaction(user: User, definitionId: number, isLike: boolean) {
    try {
      return await this.definitionLikesDislikesRepository.manager.transaction(async transactionalEntityManager => {
        // Validate the reaction request (make sure user exists, definition exists, and user is not reacting to their own definition)
        await this.validateReactionRequest(user, definitionId);

        // Check for existing reaction
        const existingReaction: DefinitionLikeDislike = await transactionalEntityManager.findOne(DefinitionLikeDislike, {
          where: { userId: user.id, definitionId }
        });

        if (existingReaction) {
          if (existingReaction.liked === isLike) {
            throw new ConflictException(
              `User has already ${isLike ? 'liked' : 'disliked'} this definition`
            );
          }

          // Remove existing reaction and update counts using SQL
          await transactionalEntityManager.remove(existingReaction);

          // Decrement the previous reaction count
          await transactionalEntityManager
            .createQueryBuilder()
            .update(Definition)
            .set({
              likeCount: () => existingReaction.liked ? 'likeCount - 1' : 'likeCount',
              dislikeCount: () => !existingReaction.liked ? 'dislikeCount - 1' : 'dislikeCount'
            })
            .where('id = :id', { id: definitionId })
            .execute();
        }

        // Create new reaction
        const newReaction = this.definitionLikesDislikesRepository.create({
          definitionId,
          userId: user.id,
          liked: isLike,
          createdAt: new Date()
        });

        await transactionalEntityManager.save(newReaction);

        // Increment the new reaction count using SQL
        await transactionalEntityManager
          .createQueryBuilder()
          .update(Definition)
          .set({
            likeCount: () => isLike ? 'likeCount + 1' : 'likeCount',
            dislikeCount: () => !isLike ? 'dislikeCount + 1' : 'dislikeCount'
          })
          .where('id = :id', { id: definitionId })
          .execute();

        return { success: true };
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error(`Failed to save reaction: ${error.message}`);
      throw new InternalServerErrorException('Failed to save reaction');
    }
  }

  async removeReaction(user: User, definitionId: number, isLike: boolean) {
    try {
      return await this.definitionLikesDislikesRepository.manager.transaction(async transactionalEntityManager => {
        // Find the reaction
        const existingReaction = await transactionalEntityManager.findOne(DefinitionLikeDislike, {
          where: { userId: user.id, definitionId, liked: isLike }
        });

        if (!existingReaction) {
          throw new NotFoundException(
            `No ${isLike ? 'like' : 'dislike'} reaction found for this definition`
          );
        }

        // Remove the reaction
        await transactionalEntityManager.remove(existingReaction);

        // Update counts using SQL decrement
        await transactionalEntityManager
          .createQueryBuilder()
          .update(Definition)
          .set({
            likeCount: () => isLike ? 'GREATEST(likeCount - 1, 0)' : 'likeCount',
            dislikeCount: () => !isLike ? 'GREATEST(dislikeCount - 1, 0)' : 'dislikeCount'
          })
          .where('id = :id', { id: definitionId })
          .execute();

        return { success: true };
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to remove reaction: ${error.message}`);
      throw new InternalServerErrorException('Failed to remove reaction');
    }
  }

  // Convenience methods
  async likeDefinition(user: User, definitionId: number) {
    return this.handleReaction(user, definitionId, true);
  }

  async dislikeDefinition(user: User, definitionId: number) {
    return this.handleReaction(user, definitionId, false);
  }

  async unlikeDefinition(user: User, definitionId: number) {
    return this.removeReaction(user, definitionId, true);
  }

  async undislikeDefinition(user: User, definitionId: number) {
    return this.removeReaction(user, definitionId, false);
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
