import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DefinitionLikeDislike } from '../typeorm/entities/definition-like-dislike';
import { DefinitionLikesDislikesService } from './services/definition-likes-dislikes/definition-likes-dislikes.service';
import { DefinitionLikesDislikesController } from './controllers/definition-likes-dislikes/definition-likes-dislikes.controller';
import { DefinitionsModule } from '../definitions/definitions.module';

@Module({
  imports: [
    DefinitionsModule,
    TypeOrmModule.forFeature([DefinitionLikeDislike]),
  ],
  controllers: [DefinitionLikesDislikesController],
  providers: [DefinitionLikesDislikesService],
})
export class DefinitionLikesDislikesModule {}
