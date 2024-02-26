import { Module } from '@nestjs/common';
import { WordsController } from './controllers/words/words.controller';
import { WordsService } from './services/words/words.service';

@Module({
  controllers: [WordsController],
  providers: [WordsService]
})
export class WordsModule {}
