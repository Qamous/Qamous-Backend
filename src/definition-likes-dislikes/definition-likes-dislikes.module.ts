import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DefinitionLikeDislike } from '../typeorm/entities/definition-like-dislike';
import { DefinitionLikesDislikesService } from './services/definition-likes-dislikes/definition-likes-dislikes.service';

@Module({
  imports: [TypeOrmModule.forFeature([DefinitionLikeDislike])],
  providers: [DefinitionLikesDislikesService],
  exports: [DefinitionLikesDislikesService],
})
export class DefinitionLikesDislikesModule {}
