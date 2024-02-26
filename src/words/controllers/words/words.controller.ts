import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { WordsService } from '../../services/words/words.service';
import { Word } from '../../../typeorm/entities/word';
import { CreateWordDto } from '../../dtos/create-word.dto';

@Controller('word')
export class WordsController {
  constructor(private wordsService: WordsService) {}

  /**
   * This creates a new word according to the details provided in the CreateWordDto object
   * and returns the newly created word
   *
   * @param {CreateWordDto} wordDetails - the details of the new word
   * @returns {Promise<Word>} - the newly created Word object
   */
  @Post('add')
  addWord(@Body() wordDetails: CreateWordDto): Promise<Word> {
    return this.wordsService.addWord(wordDetails);
  }

  /**
   * This returns a word by its id
   *
   * @param {number} wordID - the id of the word to return
   * @returns {Promise<Word>} - the Word object with the specified id
   */
  @Get(':wordID')
  getWordById(@Param('wordID') wordID: number): Promise<Word> {
    return this.wordsService.getWordById(wordID);
  }

  /**
   * This returns all words
   *
   * @returns {Promise<Word[]>} - an array of all Word objects
   */
  @Get('search/all')
  getWords(): Promise<Word[]> {
    return this.wordsService.getWords();
  }

  /**
   * This returns words by their country of use
   *
   * @param {string} countryCode - the country code of the words to return
   * @returns {Promise<Word[]>} - an array of Word objects used in the specified country
   */
  @Get('search/iso=:countryCode')
  getWordsByCountry(
    @Param('countryCode') countryCode: string,
  ): Promise<Word[]> {
    return this.wordsService.getWordsByCountry(countryCode);
  }

  /**
   * This returns words based on a search keyword that matches or is a substring of either the arabicWord
   * or francoArabicWord
   *
   * @param {string} keyword - the keyword to search for
   * @returns {Promise<Word[]>} - an array of Word objects that match the search keyword
   */
  @Get('search/kwd=:keyword')
  searchWords(@Param('keyword') keyword: string): Promise<Word[]> {
    return this.wordsService.searchWords(keyword);
  }
}
