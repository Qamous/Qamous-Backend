import { Injectable } from '@nestjs/common';
import { Word } from '../../../typeorm/entities/word';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, UpdateResult } from 'typeorm';
import { CreateWordParams } from '../../../utils/types';
import { UpdateWordDto } from '../../dtos/update-word.dto';
import { User } from '../../../typeorm/entities/user';
import { Country } from '../../../typeorm/entities/country';

@Injectable()
export class WordsService {
  constructor(
    @InjectRepository(Word) private wordsRepository: Repository<Word>,
    @InjectRepository(Country) private countryRepository: Repository<Country>,
  ) {}

  /**
   * This creates a new word according to the details provided in the Word object
   * and returns the newly created word
   *
   * @param {User} user - the user object
   * @param {Partial<Word>} wordDetails - the details of the new word
   * @returns {Promise<Word>} - the newly created Word object
   */
  async addWord(user: User, wordDetails: CreateWordParams): Promise<Word> {
    // Check if a word with the same Arabic word already exists
    const existingWord: Word = await this.wordsRepository.findOne({
      where: { arabicWord: wordDetails.arabicWord },
    });

    if (existingWord) {
      if (
        existingWord.francoArabicWord === '' ||
        !existingWord.francoArabicWord
      ) {
        existingWord.francoArabicWord = wordDetails.francoArabicWord;
        return await this.wordsRepository.save(existingWord);
      }
      return existingWord;
      /*
      
      // If the FrancoArabic word is also the same, return the existing word
      
      if (existingWord.francoArabicWord === wordDetails.francoArabicWord) {
        return existingWord;
      }
      // If the Arabic word is the same but the FrancoArabic word is different, update the FrancoArabic word of the existing word
      else {
        existingWord.francoArabicWord = wordDetails.francoArabicWord;
        return await this.wordsRepository.save(existingWord);
      }
      
      */
    }
    // If no word with the same Arabic word exists, save the new word
    else {
      const newWord: Word = this.wordsRepository.create({
        ...wordDetails,
        createdAt: new Date(),
      });
      newWord.userId = user.id;

      // Fetch the country entities from the database
      // const countries: Country[] = await this.countryRepository.findByIds(
      //   wordDetails.CountriesOfUse,
      // );
      // newWord.countries = countries;

      return await this.wordsRepository.save(newWord);
    }
  }

  /**
   * This updates a word by its id
   *
   * @param {User} user - the user object
   * @param {number} wordID - the id of the word to update
   * @param {UpdateWordDto} updateWordDto - a UpdateWordDto object that contains the
   * details of the word to replace the existing word
   * @returns {Promise<UpdateResult>} - the update result
   */
  async updateWord(
    user: User,
    wordID: number,
    updateWordDto: UpdateWordDto,
  ): Promise<UpdateResult> {
    const word: Word = await this.findWordById(wordID);
    if (!word) {
      throw new Error('Word not found');
    }
    if (word.userId !== user.id) {
      throw new Error('Unauthorized');
    }
    return await this.wordsRepository.update(wordID, updateWordDto);
  }

  /**
   * This returns a word by its id
   *
   * @param {number} id - the id of the word to return
   * @returns {Promise<Word>} - the Word object with the specified id
   */
  async findWordById(id: number): Promise<Word> {
    return await this.wordsRepository.findOne({
      where: { id },
    });
  }

  /**
   * This returns all words
   *
   * @returns {Promise<Word[]>} - an array of all Word objects
   */
  async findWords(): Promise<Word[]> {
    return await this.wordsRepository.find();
  }

  /**
   * This returns words by their country of use
   *
   * @param {string} countryCode - the country code of the words to return
   * @param {number} userId - the id of the user making the request
   * @returns an array of objects used in the specified country
   */
  // TODO: This definitely needs to be tested
  async getWordsByCountry(countryCode: string, userId: number) {
    const result = await this.wordsRepository.createQueryBuilder('word')
      .innerJoin('word.definitions', 'definition')
      .leftJoin('definition-likes-dislikes', 'likes',
        'likes.definitionId = definition.id AND likes.userId = :userId AND likes.liked = 1',
        { userId })
      .leftJoin('definition-likes-dislikes', 'dislikes',
        'dislikes.definitionId = definition.id AND likes.userId = :userId AND likes.liked = 0',
        { userId })
      .leftJoin('word-reports', 'wordReports',
        'wordReports.wordId = word.id AND wordReports.userId = :userId',
        { userId })
      .leftJoin('definition-reports', 'definitionReports',
        'definitionReports.definitionId = definition.id AND definitionReports.userId = :userId',
        { userId })
      .select([
        'word.arabicWord as arabicWord',
        'word.francoArabicWord as francoArabicWord',
        'word.id as wordId',
        'definition.id as definitionId',
        'definition.definition as definition',
        'definition.isArabic as isArabic',
        'definition.countryCode as countryCode',
        'CASE WHEN likes.id IS NOT NULL THEN true ELSE false END as isLiked',
        'CASE WHEN dislikes.id IS NOT NULL THEN true ELSE false END as isDisliked',
        'CASE WHEN wordReports.id IS NOT NULL OR definitionReports.id IS NOT NULL THEN true ELSE false END as isReported'
      ])
      .where('definition.countryCode = :countryCode', { countryCode })
      .getRawMany();

    return result.map(item => ({
      word: item.arabicWord,
      definition: item.definition,
      wordId: item.wordId,
      definitionId: item.definitionId,
      isArabic: item.isArabic ? 1 : 0,
      isLiked: item.isLiked === 1,
      isDisliked: item.isDisliked === 1,
      isReported: item.isReported === 1,
      arabicWord: item.arabicWord,
      francoArabicWord: item.francoArabicWord,
      countryCode: item.countryCode
    }));
  }

  /**
   * This returns words based on a search keyword that matches or is a substring of either the arabicWord
   * or francoArabicWord
   *
   * @param {string} keyword - the keyword to search for
   * @param {number} userId - the id of the user making the search
   * @returns {Promise<Word[]>} - an array of Word objects that match the search keyword
   */
  async searchWords(keyword: string, userId: number): Promise<Word[]> {
    const ret = await this.wordsRepository.query(
      `
      WITH RankedDefinitions AS (
          SELECT
              definition.id,
              definition.definition,
              definition.likeCount,
              definition.dislikeCount,
              definition.reportCount AS definitionReportCount,
              (definition.likeCount - definition.dislikeCount) AS likeDislikeDifference,
              definition.isArabic,
              definition.countryCode,
              definition.example,
              word.id AS wordId,
              CASE
                  WHEN definition.isArabic = 1 THEN word.arabicWord
                  ELSE word.francoArabicWord
                  END AS word,
              word.reportCount AS wordReportCount,
              IFNULL(liked.id IS NOT NULL, 0) AS isLiked,
              IFNULL(disliked.id IS NOT NULL, 0) AS isDisliked,
              IFNULL(reported.id IS NOT NULL, 0) AS isReported,
              ROW_NUMBER() OVER(PARTITION BY word.id, definition.isArabic ORDER BY (definition.likeCount - definition.dislikeCount) DESC) AS RowNum
          FROM
              definitions AS definition
          LEFT JOIN
              words AS word ON definition.wordId = word.id
          LEFT JOIN
              \`definition-likes-dislikes\` AS liked
              ON definition.id = liked.definitionId AND liked.userId = ? AND liked.liked = 1
          LEFT JOIN
              \`definition-likes-dislikes\` AS disliked
              ON definition.id = disliked.definitionId AND disliked.userId = ? AND disliked.liked = 0
          LEFT JOIN
              \`definition-reports\` AS reported
              ON definition.id = reported.definitionId AND reported.userId = ?
          WHERE
              word.reportCount <= 5 AND definition.reportCount <= 5 AND
              (word.arabicWord LIKE CONCAT('%', ?, '%') OR word.francoArabicWord LIKE CONCAT('%', ?, '%') OR definition.definition LIKE CONCAT('%', ?, '%'))
      )
      SELECT
          wordId,
          definition,
          id as definitionId,
          likeCount,
          dislikeCount,
          likeDislikeDifference,
          isArabic,
          countryCode,
          word,
          wordReportCount,
          definitionReportCount,
          isLiked,
          isDisliked,
          isReported,
          example
      FROM
          RankedDefinitions
      WHERE
          RowNum = 1
      ORDER BY
          likeDislikeDifference DESC;
  `,
      [userId, userId, userId, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`],
    );

    return ret;
  }

  /**
   * This returns words by their user id
   *
   * @param {number} userId - the id of the user to return words for
   * @returns {Promise<Word[]>} - an array of Word objects with the specified user id
   */
  async findByUserId(userId: number): Promise<Word[]> {
    return this.wordsRepository.find({ where: { userId } });
  }
}
