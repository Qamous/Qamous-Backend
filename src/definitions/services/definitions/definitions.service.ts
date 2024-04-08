import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Definition } from '../../../typeorm/entities/definition';
import { Repository, DeleteResult, UpdateResult } from 'typeorm';
import { CreateDefinitionDto } from '../../dtos/create-definition.dto';
import { UpdateDefinitionDto } from '../../dtos/update-definition.dto';

@Injectable()
export class DefinitionsService {
  constructor(
    @InjectRepository(Definition)
    private definitionsRepository: Repository<Definition>,
  ) {}

  async getDefinitions(): Promise<Definition[]> {
    return this.definitionsRepository.find();
  }

  async getMostLikedDefinitions(): Promise<any[]> {
    const ret = await this.definitionsRepository.query(`
      WITH RankedDefinitions AS (
        SELECT 
            definition.definition,
            definition.likeCount,
            definition.dislikeCount,
            (definition.likeCount - definition.dislikeCount) AS likeDislikeDifference,
            definition.isArabic,
            word.arabicWord,
            word.reportCount,
            ROW_NUMBER() OVER(PARTITION BY word.id, definition.isArabic ORDER BY (definition.likeCount - definition.dislikeCount) DESC) AS RowNum
        FROM 
            definitions AS definition
        LEFT JOIN 
            words AS word ON definition.wordId = word.id
      )
      SELECT 
          definition,
          likeCount,
          dislikeCount,
          likeDislikeDifference,
          isArabic,
          arabicWord,
          reportCount
      FROM 
          RankedDefinitions
      WHERE 
          RowNum = 1
      ORDER BY 
          likeDislikeDifference DESC;
    `);

    console.log(ret);
    return ret;
  }

  async getDefinitionById(id: number): Promise<Definition> {
    return this.definitionsRepository.findOne({
      where: { id },
    });
  }

  async createDefinition(
    createDefinitionDto: CreateDefinitionDto,
  ): Promise<Definition> {
    const newDefinition =
      this.definitionsRepository.create(createDefinitionDto);
    return this.definitionsRepository.save(newDefinition);
  }

  async updateDefinitionById(
    id: number,
    updateDefinitionDto: UpdateDefinitionDto,
  ): Promise<UpdateResult> {
    return this.definitionsRepository.update(id, updateDefinitionDto);
  }

  async deleteDefinitionById(id: number): Promise<DeleteResult> {
    return this.definitionsRepository.delete(id);
  }
}
