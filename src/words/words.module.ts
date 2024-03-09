import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Word } from '../typeorm/entities/word';
import { WordsController } from './controllers/words/words.controller';
import { WordsService } from './services/words/words.service';

@Module({
  imports: [TypeOrmModule.forFeature([Word])], // WordRepository is provided here
  controllers: [WordsController],
  providers: [WordsService],
})
export class WordsModule {}
