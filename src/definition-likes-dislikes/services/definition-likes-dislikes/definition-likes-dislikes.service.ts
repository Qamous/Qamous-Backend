import { Injectable } from "@nestjs/common";
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from "typeorm";
import { DefinitionLikeDislike } from '../../../typeorm/entities/definition-like-dislike';
import { User } from '../../../typeorm/entities/user';
import { DefinitionsService } from '../../../definitions/services/definitions/definitions.service';
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

  /**
   * Validates a reaction request
   * @param user - the user making the request
   * @param definitionId - the ID of the definition being reacted to
   * @private
   * @returns {Promise<{isValid: boolean, message?: string, definition?: Definition}>} - an object with validation result
   */
  private async validateReactionRequest(user: User, definitionId: number) {
    // Check if user exists and is active
    if (!user || !user.id) {
      this.logger.warn('Unauthenticated user attempted to react');
      return {
        isValid: false,
        message: 'User must be authenticated'
      };
    }

    // Get definition with author information
    const definition = await this.definitionsService.getDefinitionById(
      definitionId,
      { relations: ['user'] }
    );

    // Check if definition exists
    if (!definition) {
      this.logger.warn(`Definition ${definitionId} not found`);
      return {
        isValid: false,
        message: 'Definition not found'
      };
    }

    // Check for self-reaction
    if (definition.userId === user.id) {
      this.logger.warn(`User ${user.id} attempted to react to their own definition ${definitionId}`);
      return {
        isValid: false,
        message: 'You cannot react to your own definitions'
      };
    }

    return {
      isValid: true,
      definition
    };
  }

  private async handlePointUpdate(
    transactionalEntityManager: EntityManager,
    userId: number,
    definitionUserId: number,
    isLike: boolean,
    existingReaction: DefinitionLikeDislike | null
  ) {
    // Don't update points if it's a self-reaction
    if (userId === definitionUserId) {
      return;
    }

    let pointsDelta = 0;

    if (existingReaction) {
      // Switching from one reaction to another
      if (existingReaction.liked !== isLike) {
        // When switching from dislike to like:
        // - Remove the -1 point effect from dislike (+1)
        // - Add the +1 point effect from like (+1)
        // Total should be +2

        // When switching from like to dislike:
        // - Remove the +1 point effect from like (-1)
        // - Add the -1 point effect from dislike (-1)
        // Total should be -2

        if (isLike) {
          // Switching from dislike to like
          pointsDelta = 2; // +1 (removing dislike) +1 (adding like)
        } else {
          // Switching from like to dislike
          pointsDelta = -2; // -1 (removing like) -1 (adding dislike)
        }
      }
    } else {
      // New reaction (no previous reaction)
      pointsDelta = isLike ? 1 : -1;
    }

    // Only update points if there's a change
    if (pointsDelta !== 0) {
      await transactionalEntityManager
        .getRepository(User)
        .increment({ id: definitionUserId }, 'points', pointsDelta);
    }
  }

  /**
   * Checks and updates the like or dislike count for a definition
   * @param transactionalEntityManager - the transactional entity manager
   * @param definitionId - the ID of the definition
   * @param column - the column to update
   * @param increment - whether to increment or decrement the count
   * @private
   * @returns {Promise<boolean>} - whether the update was successful
   */
  private async checkAndUpdateReactionCount(
    transactionalEntityManager: EntityManager,
    definitionId: number,
    column: 'likeCount' | 'dislikeCount',
    increment: boolean
  ): Promise<boolean> {
    // First get the current count
    const definition = await transactionalEntityManager
      .createQueryBuilder(Definition, 'definition')
      .select(`definition.${column}`, 'count')
      .where('definition.id = :id', { id: definitionId })
      .getRawOne();

    // If decrementing and count is 0 or undefined, prevent the update
    if (!increment && (!definition || definition.count <= 0)) {
      this.logger.warn(`Attempted to decrement ${column} below 0 for definition ${definitionId}`);
      return false;
    }

    // Perform the update
    await transactionalEntityManager
      .createQueryBuilder()
      .update(Definition)
      .set({
        [column]: () => `${column} ${increment ? '+ 1' : '- 1'}`
      })
      .where('id = :id', { id: definitionId })
      .execute();

    return true;
  }


  /**
   * Handles a reaction request
   * @param user - the user making the request
   * @param definitionId - the ID of the definition being reacted to
   * @param isLike - whether the reaction is a like or dislike
   * @returns {Promise<{success: boolean, message: string}>} - an object with the result of the operation
   */
  async handleReaction(user: User, definitionId: number, isLike: boolean) {
    // Use a transaction to ensure data consistency
    return await this.definitionLikesDislikesRepository.manager.transaction(async transactionalEntityManager => {
      // Validate the request
      const validationResult = await this.validateReactionRequest(user, definitionId);
      if (!validationResult.isValid) {
        // Return error message if validation fails
        return {
          success: false,
          message: validationResult.message
        };
      }
      const definition: Definition = validationResult.definition;

      // Check for existing reaction
      const existingReaction: DefinitionLikeDislike = await transactionalEntityManager.findOne(DefinitionLikeDislike, {
        where: { userId: user.id, definitionId }
      });
      if (existingReaction) {
        if (existingReaction.liked === isLike) {
          return {
            success: false,
            message: `You have already ${isLike ? 'liked' : 'disliked'} this definition`
          };
        }

        // Update counters safely
        const oldTypeColumn: "likeCount" | "dislikeCount" = existingReaction.liked ? 'likeCount' : 'dislikeCount';
        const newTypeColumn: "likeCount" | "dislikeCount" = isLike ? 'likeCount' : 'dislikeCount';
        const decrementSuccess: boolean = await this.checkAndUpdateReactionCount(
          transactionalEntityManager,
          definitionId,
          oldTypeColumn,
          false
        );
        if (!decrementSuccess) {
          return {
            success: false,
            message: 'Cannot update reaction counts below 0'
          };
        }
        await this.checkAndUpdateReactionCount(
          transactionalEntityManager,
          definitionId,
          newTypeColumn,
          true
        );

        // Remove existing reaction
        await transactionalEntityManager.remove(existingReaction);

        // Create new reaction
        const newReaction = transactionalEntityManager.create(DefinitionLikeDislike, {
          userId: user.id,
          definitionId,
          liked: isLike
        });

        await transactionalEntityManager.save(newReaction);

        return {
          success: true,
          message: `Successfully ${isLike ? 'liked' : 'disliked'} the definition`
        };
      } else {  // If there was no existing reaction
        // Handle points update for new reaction
        await this.handlePointUpdate(
          transactionalEntityManager,
          user.id,
          definition.userId,
          isLike,
          null
        );

        // Create new reaction
        const newReaction = transactionalEntityManager.create(DefinitionLikeDislike, {
          userId: user.id,
          definitionId,
          liked: isLike
        });
        await transactionalEntityManager.save(newReaction);

        // Update counter safely
        const column = isLike ? 'likeCount' : 'dislikeCount';
        await this.checkAndUpdateReactionCount(
          transactionalEntityManager,
          definitionId,
          column,
          true
        );

        // Return success message
        return {
          success: true,
          message: `Successfully ${isLike ? 'liked' : 'disliked'} the definition`
        };
      }
    });
  }

  /**
   * Removes a reaction
   * @param user - the user making the request
   * @param definitionId - the ID of the definition being reacted to
   * @returns {Promise<{success: boolean, message: string}>} - an object with the result of the operation
   */
  async removeReaction(user: User, definitionId: number) {
    // Use a transaction to ensure data consistency
    return await this.definitionLikesDislikesRepository.manager.transaction(async transactionalEntityManager => {
      // Validate the request
      const validationResult = await this.validateReactionRequest(user, definitionId);
      if (!validationResult.isValid) {
        // Return error message if validation fails
        return {
          success: false,
          message: validationResult.message
        };
      }
      const definition = validationResult.definition;

      // Check for existing reaction
      const existingReaction = await transactionalEntityManager.findOne(DefinitionLikeDislike, {
        where: { userId: user.id, definitionId }
      });
      if (!existingReaction) {
        return {
          success: false,
          message: 'No reaction found to remove'
        };
      }

      // Update points
      if (user.id !== definition.userId) {
        const pointsDelta: number = existingReaction.liked ? -1 : 1;
        await transactionalEntityManager
          .getRepository(User)
          .increment({ id: definition.userId }, 'points', pointsDelta);
      }

      // Update counter safely
      const column = existingReaction.liked ? 'likeCount' : 'dislikeCount';
      const decrementSuccess = await this.checkAndUpdateReactionCount(
        transactionalEntityManager,
        definitionId,
        column,
        false
      );

      if (!decrementSuccess) {
        return {
          success: false,
          message: 'Cannot remove reaction: count would become negative'
        };
      }

      // Remove the reaction
      await transactionalEntityManager.remove(existingReaction);

      return {
        success: true,
        message: 'Successfully removed reaction'
      };
    });
  }

// Convenience methods
  async likeDefinition(user: User, definitionId: number) {
    return this.handleReaction(user, definitionId, true);
  }

  async dislikeDefinition(user: User, definitionId: number) {
    return this.handleReaction(user, definitionId, false);
  }

  async unlikeDefinition(user: User, definitionId: number) {
    return this.removeReaction(user, definitionId);
  }

  async undislikeDefinition(user: User, definitionId: number) {
    return this.removeReaction(user, definitionId);;
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

  async switchReaction(
    user: User,
    definitionId: number,
    toReaction: 'like' | 'dislike'
  ): Promise<{ success: boolean; message?: string }> {
    const validationResult = await this.validateReactionRequest(user, definitionId);
    if (!validationResult.isValid) {
      return {
        success: false,
        message: validationResult.message
      };
    }

    const definition = validationResult.definition;

    return await this.definitionLikesDislikesRepository.manager.transaction(
      async (transactionalEntityManager) => {
        const existingReaction = await transactionalEntityManager
          .getRepository(DefinitionLikeDislike)
          .findOne({
            where: {
              userId: user.id,
              definitionId: definitionId
            }
          });

        // If reaction exists but is the same as requested, do nothing
        if (
          (existingReaction?.liked && toReaction === 'like') ||
          (!existingReaction?.liked && toReaction === 'dislike')
        ) {
          return {
            success: false,
            message: `Definition is already ${toReaction}d`
          };
        }

        // Handle the reaction change
        if (existingReaction) {
          // Update existing reaction
          existingReaction.liked = toReaction === 'like';
          await transactionalEntityManager.save(existingReaction);

          // Update definition counts in a single operation
          const likesDelta = toReaction === 'like' ? 1 : -1;
          const dislikesDelta = toReaction === 'like' ? -1 : 1;

          await transactionalEntityManager
            .createQueryBuilder()
            .update(Definition)
            .set({
              likeCount: () => `likeCount + ${likesDelta}`,
              dislikeCount: () => `dislikeCount + ${dislikesDelta}`
            })
            .where("id = :id", { id: definitionId })
            .execute();

        } else {
          // Create new reaction
          const newReaction = new DefinitionLikeDislike();
          newReaction.userId = user.id;
          newReaction.definitionId = definitionId;
          newReaction.liked = toReaction === 'like';
          await transactionalEntityManager.save(newReaction);

          // Update definition count
          await transactionalEntityManager
            .createQueryBuilder()
            .update(Definition)
            .set({
              [toReaction === 'like' ? 'likeCount' : 'dislikeCount']: () =>
                `${toReaction === 'like' ? 'likeCount' : 'dislikeCount'} + 1`
            })
            .where("id = :id", { id: definitionId })
            .execute();
        }

        // Calculate and update points in a single operation
        if (user.id !== definition.userId) {
          let pointsDelta: number;

          if (existingReaction) {
            // Switching reactions
            pointsDelta = toReaction === 'like' ? 2 : -2;
          } else {
            // New reaction
            pointsDelta = toReaction === 'like' ? 1 : -1;
          }

          await transactionalEntityManager
            .createQueryBuilder()
            .update(User)
            .set({
              points: () => `points + ${pointsDelta}`
            })
            .where("id = :id", { id: definition.userId })
            .execute();
        }

        return {
          success: true,
          message: existingReaction
            ? `Successfully switched to ${toReaction}`
            : `Successfully ${toReaction}d the definition`
        };
      }
    );
  }

  async removeAllReactions() {
    // Use a transaction to ensure both operations complete successfully
    return await this.definitionLikesDislikesRepository.manager.transaction(async manager => {
      // Clear all reactions
      await manager.clear(DefinitionLikeDislike);

      // Reset all like and dislike counts to 0
      await manager
        .createQueryBuilder()
        .update(Definition)
        .set({
          likeCount: 0,
          dislikeCount: 0
        })
        .execute();
    });
  }

  async recalculateAllDefinitionReactions() {
    const allDefinitionReactions = await this.definitionLikesDislikesRepository
      .createQueryBuilder('reaction')
      .select('reaction.definitionId')
      .addSelect('COUNT(CASE WHEN reaction.isLike = true THEN 1 END)', 'likes')
      .addSelect('COUNT(CASE WHEN reaction.isLike = false THEN 1 END)', 'dislikes')
      .groupBy('reaction.definitionId')
      .getRawMany();

    const results = [];
    for (const reaction of allDefinitionReactions) {
      results.push({
        definitionId: reaction.definitionId,
        likes: parseInt(reaction.likes) || 0,
        dislikes: parseInt(reaction.dislikes) || 0
      });
    }

    return results;
  }
}
