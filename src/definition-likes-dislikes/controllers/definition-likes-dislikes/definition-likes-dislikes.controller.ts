import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseGuards,
  Request,
  Logger
} from "@nestjs/common";
import { DefinitionLikesDislikesService } from '../../services/definition-likes-dislikes/definition-likes-dislikes.service';
import { AuthenticatedGuard, LocalAuthGuard } from '../../../utils/local.guard';
import { RequestType } from 'express-serve-static-core';
import { Throttle } from '@nestjs/throttler';
import { User } from "../../../typeorm/entities/user";
import { DefinitionsService } from "../../../definitions/services/definitions/definitions.service";

interface UserRequest extends Request {
  user?: User;
}

@Controller('reactions')
export class DefinitionLikesDislikesController {
  private readonly logger = new Logger(DefinitionLikesDislikesController.name);
  constructor(
    private readonly definitionLikesDislikesService: DefinitionLikesDislikesService,
    private readonly definitionsService: DefinitionsService,
  ) {}

  @UseGuards(AuthenticatedGuard)
  //@Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute
  @Post(':definitionID/like')
  async likeDefinition(
    @Request() req: UserRequest,
    @Param('definitionID') definitionID: number,
  ) {
    try {
      // First check if the definition exists
      const definition = await this.definitionsService.getDefinitionById(
        definitionID,
        { relations: ['user'] },
      );
      const result = await this.definitionLikesDislikesService.likeDefinition(
        req.user,
        definitionID,
      );
      return result;
    } catch (error) {
      this.logger.error(`Detailed error in likeDefinition: ${error.stack}`);
      throw error;
    }
  }

  @UseGuards(AuthenticatedGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute
  @Post(':definitionID/dislike')
  async dislikeDefinition(
    @Request() req: UserRequest,
    @Param('definitionID') definitionID: number,
  ) {
    return await this.definitionLikesDislikesService.dislikeDefinition(
      req.user,
      definitionID,
    );
  }

  @UseGuards(AuthenticatedGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute
  @Post(':definitionID/unlike')
  async unlikeDefinition(
    @Request() req: UserRequest,
    @Param('definitionID') definitionID: number,
  ) {
    return await this.definitionLikesDislikesService.unlikeDefinition(
      req.user,
      definitionID,
    );
  }

  @UseGuards(AuthenticatedGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute
  @Post(':definitionID/undislike')
  async undislikeDefinition(
    @Request() req: UserRequest,
    @Param('definitionID') definitionID: number,
  ) {
    return await this.definitionLikesDislikesService.undislikeDefinition(
      req.user,
      definitionID,
    );
  }

  @Get(':definitionID/likes-dislikes')
  async getLikesDislikes(@Param('definitionID') definitionID: number) {
    return await this.definitionLikesDislikesService.getLikesDislikes(
      definitionID,
    );
  }

  @Get(':definitionID/likes')
  async getLikes(@Param('definitionID') definitionID: number) {
    return await this.definitionLikesDislikesService.getLikes(definitionID);
  }

  @Get(':definitionID/dislikes')
  async getDislikes(@Param('definitionID') definitionID: number) {
    return await this.definitionLikesDislikesService.getDislikes(definitionID);
  }

  @UseGuards(LocalAuthGuard)
  @Delete(':definitionID/likes/:userID')
  async removeLike(
    @Request() req: RequestType,
    @Param('definitionID') definitionID: number,
  ) {
    return await this.definitionLikesDislikesService.removeLike(
      req.user,
      definitionID,
    );
  }

  @UseGuards(LocalAuthGuard)
  @Delete(':definitionID/dislikes/:userID')
  async removeDislike(
    @Request() req: RequestType,
    @Param('definitionID') definitionID: number,
  ) {
    return await this.definitionLikesDislikesService.removeDislike(
      req.user,
      definitionID,
    );
  }
}
