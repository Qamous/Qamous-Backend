import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { DefinitionLikesDislikesService } from '../../services/definition-likes-dislikes/definition-likes-dislikes.service';
import { LocalAuthGuard } from '../../../utils/local.guard';
import { RequestType } from 'express-serve-static-core';

@Controller('reactions')
export class DefinitionLikesDislikesController {
  constructor(
    private readonly definitionLikesDislikesService: DefinitionLikesDislikesService,
  ) {}

  @UseGuards(LocalAuthGuard)
  @Post(':definitionID/like')
  async likeDefinition(
    @Request() req: RequestType,
    @Param('definitionID') definitionID: number,
  ) {
    return await this.definitionLikesDislikesService.likeDefinition(
      req.user,
      definitionID,
    );
  }

  @UseGuards(LocalAuthGuard)
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
