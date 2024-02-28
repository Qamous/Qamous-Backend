import { Module } from '@nestjs/common';
import { DefinitionLikesDislikesController } from './controllers/definition-likes-dislikes/definition-likes-dislikes.controller';
import { DefinitionLikesDislikesService } from './services/definition-likes-dislikes/definition-likes-dislikes.service';

@Module({
  controllers: [DefinitionLikesDislikesController],
  providers: [DefinitionLikesDislikesService]
})
export class DefinitionLikesDislikesModule {}
