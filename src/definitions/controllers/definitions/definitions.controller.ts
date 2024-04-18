import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { DefinitionsService } from '../../services/definitions/definitions.service';
import { Definition } from '../../../typeorm/entities/definition';
import { CreateDefinitionDto } from '../../dtos/create-definition.dto';
import { UpdateDefinitionDto } from '../../dtos/update-definition.dto';
import { DeleteResult, UpdateResult } from 'typeorm';
import { Throttle } from '@nestjs/throttler';

@Controller('definitions')
export class DefinitionsController {
  constructor(private definitionsService: DefinitionsService) {}

  @Get()
  async getDefinitions(): Promise<Definition[]> {
    return this.definitionsService.getDefinitions();
  }

  @Get('most-liked')
  @Throttle({ default: { limit: 15, ttl: 60000 } }) // 15 requests per minute
  async getMostLikedDefinitions(): Promise<Definition[]> {
    return this.definitionsService.getMostLikedDefinitions();
  }

  @Get(':id')
  async getDefinitionById(@Param('id') id: number): Promise<Definition> {
    return this.definitionsService.getDefinitionById(id);
  }

  @Post()
  async createDefinition(
    @Body() createDefinitionDto: CreateDefinitionDto,
  ): Promise<Definition> {
    return this.definitionsService.createDefinition(createDefinitionDto);
  }

  @Patch(':id')
  async updateDefinitionById(
    @Param('id') id: number,
    @Body() updateDefinitionDto: UpdateDefinitionDto,
  ): Promise<UpdateResult> {
    return this.definitionsService.updateDefinitionById(
      id,
      updateDefinitionDto,
    );
  }

  @Delete(':id')
  async deleteDefinitionById(@Param('id') id: number): Promise<DeleteResult> {
    return this.definitionsService.deleteDefinitionById(id);
  }
}
