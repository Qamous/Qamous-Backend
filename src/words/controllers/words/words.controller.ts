import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Request,
  UseGuards,
} from '@nestjs/common';
import { WordsService } from '../../services/words/words.service';
import { Word } from '../../../typeorm/entities/word';
import { CreateWordDto } from '../../dtos/create-word.dto';
import { UpdateWordDto } from '../../dtos/update-word.dto';
import { UpdateResult } from 'typeorm';
import { AuthenticatedGuard } from '../../../utils/local.guard';
import { RequestType } from 'express-serve-static-core';

@Controller('word')
export class WordsController {
  constructor(private wordsService: WordsService) {}

  /**
   * This is a POST request to /word/add that creates a new word according to the details provided in the
   * CreateWordDto object and returns the newly created word
   *
   * @param {RequestType} req - the request object
   * @param {CreateWordDto} wordDetails - the details of the new word
   * @returns {Promise<Word>} - the newly created Word object
   */
  @UseGuards(AuthenticatedGuard)
  @Post('')
  async addWord(
    @Request() req: RequestType,
    @Body() wordDetails: CreateWordDto,
  ): Promise<Word> {
    return await this.wordsService.addWord(req.user, wordDetails);
  }

  /**
   * This is a PATCH request to /word/:wordID that updates a word by its id
   *
   * @param {RequestType} req - the request object
   * @param {number} wordID - the id of the word to update
   * @param {UpdateWordDto} updateWordDto - a UpdateWordDto object that contains the
   * details of the word to replace the existing word
   * @returns {Promise<UpdateResult>} - the update result
   */
  @UseGuards(AuthenticatedGuard)
  @Patch(':wordID')
  async updateWord(
    @Request() req: RequestType,
    @Param('wordID') wordID: number,
    @Body() updateWordDto: UpdateWordDto,
  ): Promise<UpdateResult> {
    return await this.wordsService.updateWord(req.user, wordID, updateWordDto);
  }

  /**
   * This is a GET request to /word/:wordID that returns a word by its id
   *
   * @param {number} wordID - the id of the word to return
   * @returns {Promise<Word>} - the Word object with the specified id
   */
  @Get(':wordID')
  async getWordById(@Param('wordID') wordID: number): Promise<Word> {
    return await this.wordsService.findWordById(wordID);
  }

  /**
   * This is a GET request to /word/search/all that returns all words
   *
   * @returns {Promise<Word[]>} - an array of all Word objects
   */
  @Get('search/all')
  async getWords(): Promise<Word[]> {
    return await this.wordsService.findWords();
  }

  /**
   * This is a GET request to /word/search/iso=:countryCode that returns words by their country of use
   *
   * @param {string} countryCode - the country code of the words to return
   * @returns {Promise<Word[]>} - an array of Word objects used in the specified country
   */
  @Get('search/iso=:countryCode')
  async getWordsByCountry(
    @Param('countryCode') countryCode: string,
  ): Promise<Word[]> {
    return await this.wordsService.getWordsByCountry(countryCode);
  }

  /**
   * This is a GET request to /word/search/kwd=:keyword that returns an array of Word objects that either match the
   * search keyword or contain the search keyword in their word (TODO: or definition).
   *
   * @param {string} keyword - the keyword to search for
   * @returns {Promise<Word[]>} - an array of Word objects that match the search keyword
   */
  @Get('search/kwd=:keyword')
  async searchWords(@Param('keyword') keyword: string): Promise<Word[]> {
    return await this.wordsService.searchWords(keyword);
  }
}
