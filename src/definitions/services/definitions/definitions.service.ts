import { forwardRef, HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from '@nestjs/typeorm';
import { Definition } from '../../../typeorm/entities/definition';
import { Repository, DeleteResult, UpdateResult } from 'typeorm';
import { CreateDefinitionDto } from '../../dtos/create-definition.dto';
import { UpdateDefinitionDto } from '../../dtos/update-definition.dto';
import { User } from '../../../typeorm/entities/user';
import { Country } from '../../../typeorm/entities/country';
import { countryCodes } from '../../../utils/country-codes';
import { UsersService } from "../../../users/services/users/users.service";

type MostLikedDefinition = {
  wordId: number;
  definition: string;
  likeCount: number;
  dislikeCount: number;
  likeDislikeDifference: number;
  isArabic: boolean;
  word: string;
  wordReportCount: number;
  definitionReportCount: number;
};

@Injectable()
export class DefinitionsService {
  constructor(
    @InjectRepository(Definition)
    private definitionsRepository: Repository<Definition>,
    @InjectRepository(Country)
    private countriesRepository: Repository<Country>,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
  ) {}

  async getDefinitions(): Promise<Definition[]> {
    return this.definitionsRepository.find();
  }

  async getMostLikedDefinitions(
    userId: number,
    page: number = 1,
    limit: number = 10,
  ): Promise<Definition[]> {
    const offset = (page - 1) * limit;
    const ret = await this.definitionsRepository.query(
      `
          WITH RankedDefinitions AS (SELECT definition.id,
                                            definition.definition,
                                            definition.likeCount,
                                            definition.dislikeCount,
                                            definition.reportCount                           AS definitionReportCount,
                                            (definition.likeCount - definition.dislikeCount) AS likeDislikeDifference,
                                            definition.isArabic,
                                            definition.countryCode,
                                            definition.example,
                                            word.id                                          AS wordId,
                                            CASE
                                                WHEN definition.isArabic = 1 THEN word.arabicWord
                                                ELSE word.francoArabicWord
                                                END                                          AS word,
                                            word.reportCount                                 AS wordReportCount,
                                            IFNULL(liked.id IS NOT NULL, 0)                  AS isLiked,
                                            IFNULL(disliked.id IS NOT NULL, 0)               AS isDisliked,
                                            IFNULL(reported.id IS NOT NULL, 0)               AS isReported,
                                            ROW_NUMBER() OVER (
                                                PARTITION BY word.id, definition.isArabic
                                                ORDER BY (definition.likeCount - definition.dislikeCount) DESC
                                                )                                            AS RowNum
                                     FROM definitions AS definition
                                              LEFT JOIN words AS word ON definition.wordId = word.id
                                              LEFT JOIN \`definition-likes-dislikes\` AS liked
                                                        ON definition.id = liked.definitionId AND liked.userId = ? AND
                                                           liked.liked = 1
                                              LEFT JOIN \`definition-likes-dislikes\` AS disliked
                                                        ON definition.id = disliked.definitionId AND
                                                           disliked.userId = ? AND disliked.liked = 0
                                              LEFT JOIN \`definition-reports\` AS reported
                                                        ON definition.id = reported.definitionId AND reported.userId = ?
                                     WHERE word.reportCount <= 5
                                       AND definition.reportCount <= 5)
          SELECT wordId,
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
          FROM RankedDefinitions
          WHERE RowNum = 1
          ORDER BY (likeDislikeDifference + RAND() * 25) DESC
          LIMIT ? OFFSET ?;
      `,
      [userId, userId, userId, limit, offset],
    );

    return ret;
  }

  async getRandomMatchingDefinitions(): Promise<Definition[]> {
    const ret = await this.definitionsRepository.query(
      `
          WITH RandomWord AS (
              SELECT wordId
              FROM definitions
              GROUP BY wordId
              HAVING COUNT(CASE WHEN isArabic = 1 THEN 1 END) > 0
                 AND COUNT(CASE WHEN isArabic = 0 THEN 1 END) > 0
              ORDER BY RAND()
              LIMIT 1
          ),
               TopLikedDefinitions AS (
                   SELECT definition.id,
                          definition.definition,
                          definition.likeCount,
                          definition.dislikeCount,
                          definition.reportCount AS definitionReportCount,
                          definition.isArabic,
                          definition.countryCode,
                          word.id AS wordId,
                          CASE
                              WHEN definition.isArabic = 1 THEN word.arabicWord
                              ELSE word.francoArabicWord
                              END AS word,
                          word.reportCount AS wordReportCount,
                          IFNULL(liked.id IS NOT NULL, 0) AS isLiked,
                          IFNULL(disliked.id IS NOT NULL, 0) AS isDisliked,
                          IFNULL(reported.id IS NOT NULL, 0) AS isReported,
                          ROW_NUMBER() OVER (PARTITION BY definition.isArabic ORDER BY (definition.likeCount - definition.dislikeCount) DESC) AS ranking
                   FROM definitions AS definition
                            LEFT JOIN words AS word ON definition.wordId = word.id
                            LEFT JOIN \`definition-likes-dislikes\` AS liked
                                       ON definition.id = liked.definitionId AND liked.liked = 1
                            LEFT JOIN \`definition-likes-dislikes\` AS disliked
                                       ON definition.id = disliked.definitionId AND disliked.liked = 0
                            LEFT JOIN \`definition-reports\` AS reported
                                       ON definition.id = reported.definitionId
                    WHERE definition.wordId = (SELECT wordId FROM RandomWord)
                   )
                   SELECT *
                   FROM TopLikedDefinitions
                   WHERE ranking = 1
                   ORDER BY isArabic DESC;
      `,
    );

    return ret;
  }

  async getDefinitionById(
    id: number,
    options?: { relations?: string[] },
  ): Promise<Definition> {
    return this.definitionsRepository.findOne({
      where: { id },
      relations: options?.relations,
    });
  }

  async getDefinitionsByUserId(userId: number): Promise<Definition[]> {
    return this.definitionsRepository.find({
      where: { userId },
      relations: ['word'],
    });
  }

  async getDefinitionsByWordId(wordId: number): Promise<Definition[]> {
    return this.definitionsRepository
      .createQueryBuilder('definition')
      .innerJoinAndSelect('definition.word', 'word')
      .where('definition.wordId = :wordId', { wordId })
      .andWhere('word.reportCount + definition.reportCount < 5')
      .getMany();
  }

  async createDefinition(
    user: User,
    createDefinitionDto: CreateDefinitionDto,
  ): Promise<Definition> {
    const { countryName, ...rest } = createDefinitionDto;
    const newDefinition: Definition = this.definitionsRepository.create(rest);
    newDefinition.user = user;

    let modifiedCountryName: string = countryName;

    if (modifiedCountryName != null && modifiedCountryName.charAt(0) === ' ') {
      modifiedCountryName = modifiedCountryName.substring(1);
    }

    // Find the country
    let country: Country = await this.countriesRepository.findOne({
      where: { countryName: modifiedCountryName },
    });
    if (!country) {
      const countryCode: string = countryCodes[modifiedCountryName] || 'XX';
      // XX: Unknown or unspecified country
      country = this.countriesRepository.create({
        countryCode: countryCode,
        countryName: modifiedCountryName,
      });
      country = await this.countriesRepository.save(country);
    }

    // Assign the countries to the definition
    newDefinition.country = country;

    const result = this.definitionsRepository.save(newDefinition);

    // Award point for creating a definition
    await this.usersService.updateUserPoints(user.id, 1);

    // If this is a new word (first definition), award extra point
    const isNewWord = await this.isFirstDefinitionForWord(newDefinition.wordId);
    if (isNewWord) {
      await this.usersService.updateUserPoints(user.id, 1);
    }

    return result;
  }

  async updateDefinitionReactionCounts(
    definitionId: number,
    updateDefinitionDto: Partial<Pick<UpdateDefinitionDto, 'likeCount' | 'dislikeCount'>>,
  ) {
    // Only allow updating the reaction counts
    const allowedUpdate = {
      ...(updateDefinitionDto.likeCount !== undefined && { likeCount: updateDefinitionDto.likeCount }),
      ...(updateDefinitionDto.dislikeCount !== undefined && { dislikeCount: updateDefinitionDto.dislikeCount }),
    };

    const result = await this.definitionsRepository.update(
      { id: definitionId },
      allowedUpdate,
    );

    if (result.affected === 0) {
      throw new HttpException('Definition not found', HttpStatus.NOT_FOUND);
    }

    return result;
  }

  async updateDefinitionById(
    user: User,
    id: number,
    updateDefinitionDto: UpdateDefinitionDto,
  ): Promise<UpdateResult> {
    const definition: Definition = await this.getDefinitionById(id);

    if (!definition) {
      throw new HttpException('Definition not found', HttpStatus.NOT_FOUND);
    }
    if (definition.userId !== user.id) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    return this.definitionsRepository.update(id, updateDefinitionDto);
  }

  async deleteDefinitionById(user: User, id: number): Promise<DeleteResult> {
    const definition = await this.definitionsRepository.findOne({
      where: { id },
    });

    if (!definition) {
      throw new HttpException('Definition not found', HttpStatus.NOT_FOUND);
    }
    if (definition.userId !== user.id) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    return this.definitionsRepository.delete(id);
  }

  async getDefinitionCountryById(id: number): Promise<Country> {
    const definition = await this.definitionsRepository.findOne({
      where: { id },
      relations: ['country'],
    });

    if (!definition) {
      throw new HttpException('Definition not found', HttpStatus.NOT_FOUND);
    }

    return definition.country;
  }

  /**
   * This method finds definitions by user id
   *
   * @param {number} userId - the id of the user to find definitions by
   * @returns {Promise<Definition[]>} - an array of definitions
   */
  async findByUserId(userId: number): Promise<Definition[]> {
    return this.definitionsRepository.find({ where: { userId } });
  }

  /**
   * This method checks if a definition is the first definition for a word
   *
   * @param {number} wordId - the id of the word to check
   * @returns {Promise<boolean>} - true if the definition is the first definition for the word, false otherwise
   */
  private async isFirstDefinitionForWord(wordId: number): Promise<boolean> {
    const count = await this.definitionsRepository.count({
      where: { wordId }
    });
    return count === 0;
  }
}
