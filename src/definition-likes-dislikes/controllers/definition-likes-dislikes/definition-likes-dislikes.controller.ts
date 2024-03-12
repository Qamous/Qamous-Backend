import { Controller, Post, Get, Delete, Param, Body } from '@nestjs/common';
import { DefinitionLikesDislikesService } from '../../services/definition-likes-dislikes/definition-likes-dislikes.service';

@Controller('reactions')
export class DefinitionLikesDislikesController {
  constructor(
    private readonly definitionLikesDislikesService: DefinitionLikesDislikesService,
  ) {}

  @Post(':definitionID/likes')
  async likeDefinition(
    @Param('definitionID') definitionID: string,
    @Body('userID') userID: string,
  ) {
    return await this.definitionLikesDislikesService.likeDefinition(
      definitionID,
      userID,
    );
  }

  @Post(':definitionID/dislikes')
  async dislikeDefinition(
    @Param('definitionID') definitionID: string,
    @Body('userID') userID: string,
  ) {
    return await this.definitionLikesDislikesService.dislikeDefinition(
      definitionID,
      userID,
    );
  }

  @Get(':definitionID/likes-dislikes')
  async getLikesDislikes(@Param('definitionID') definitionID: string) {
    return await this.definitionLikesDislikesService.getLikesDislikes(
      definitionID,
    );
  }

  @Get(':definitionID/likes')
  async getLikes(@Param('definitionID') definitionID: string) {
    return await this.definitionLikesDislikesService.getLikes(definitionID);
  }

  @Get(':definitionID/dislikes')
  async getDislikes(@Param('definitionID') definitionID: string) {
    return await this.definitionLikesDislikesService.getDislikes(definitionID);
  }

  @Delete(':definitionID/likes/:userID')
  async removeLike(
    @Param('definitionID') definitionID: string,
    @Param('userID') userID: string,
  ) {
    return await this.definitionLikesDislikesService.removeLike(
      definitionID,
      userID,
    );
  }

  @Delete(':definitionID/dislikes/:userID')
  async removeDislike(
    @Param('definitionID') definitionID: string,
    @Param('userID') userID: string,
  ) {
    return await this.definitionLikesDislikesService.removeDislike(
      definitionID,
      userID,
    );
  }
}
