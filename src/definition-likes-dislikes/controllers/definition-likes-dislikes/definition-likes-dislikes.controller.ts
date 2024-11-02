import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseGuards,
  Request,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { DefinitionLikesDislikesService } from '../../services/definition-likes-dislikes/definition-likes-dislikes.service';
import { AuthenticatedGuard, LocalAuthGuard } from '../../../utils/local.guard';
import { RequestType } from 'express-serve-static-core';
import { Throttle } from '@nestjs/throttler';

@Controller('reactions')
export class DefinitionLikesDislikesController {
  constructor(
    private readonly definitionLikesDislikesService: DefinitionLikesDislikesService,
  ) {}

  @UseGuards(AuthenticatedGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute
  @Post(':definitionID/like')
  async likeDefinition(
    @Request() req: RequestType,
    @Param('definitionID') definitionID: number,
  ) {
    console.log(definitionID);
    return await this.definitionLikesDislikesService.likeDefinition(
      req.user,
      definitionID,
    );
  }

  @UseGuards(AuthenticatedGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute
  @Post(':definitionID/dislike')
  async dislikeDefinition(
    @Request() req: RequestType,
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
    @Request() req: RequestType,
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
    @Request() req: RequestType,
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
