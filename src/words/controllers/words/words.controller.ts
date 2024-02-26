import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { WordsService } from '../../services/words/words.service';
import { Word } from '../../../typeorm/entities/word';
import { CreateWordDto } from '../../dtos/create-word.dto';

@Controller('word')
export class WordsController {
  constructor(private wordsService: WordsService) {}

  @Post('add')
  addWord(@Body() wordDetails: CreateWordDto): Promise<Word> {
    return this.wordsService.addWord(wordDetails);
  }

  @Get(':wordID')
  getWordById(@Param('wordID') wordID: number): Promise<Word> {
    return this.wordsService.getWordById(wordID);
  }

  @Get('search/all')
  getWords(): Promise<Word[]> {
    return this.wordsService.getWords();
  }

  @Get('search/iso=:countryCode')
  getWordsByCountry(
    @Param('countryCode') countryCode: string,
  ): Promise<Word[]> {
    return this.wordsService.getWordsByCountry(countryCode);
  }

  @Get('search/kwd=:keyword')
  searchWords(@Param('keyword') keyword: string): Promise<Word[]> {
    return this.wordsService.searchWords(keyword);
  }
}
