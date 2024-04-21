import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DefinitionsService } from '../../services/definitions/definitions.service';
import { Definition } from '../../../typeorm/entities/definition';
import { CreateDefinitionDto } from '../../dtos/create-definition.dto';
import { UpdateDefinitionDto } from '../../dtos/update-definition.dto';
import { DeleteResult, UpdateResult } from 'typeorm';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedGuard } from '../../../utils/local.guard';
import { RequestType } from 'express-serve-static-core';
import { Country } from '../../../typeorm/entities/country';

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

  @UseGuards(AuthenticatedGuard)
  @Post()
  async createDefinition(
    @Req() req: RequestType,
    @Body() createDefinitionDto: CreateDefinitionDto,
  ): Promise<Definition> {
    return this.definitionsService.createDefinition(
      req.user,
      createDefinitionDto,
    );
  }

  @UseGuards(AuthenticatedGuard)
  @Patch(':id')
  async updateDefinitionById(
    @Req() req: RequestType,
    @Param('id') id: number,
    @Body() updateDefinitionDto: UpdateDefinitionDto,
  ): Promise<UpdateResult> {
    return this.definitionsService.updateDefinitionById(
      req.user,
      id,
      updateDefinitionDto,
    );
  }

  @UseGuards(AuthenticatedGuard)
  @Delete(':id')
  async deleteDefinitionById(
    @Req() req: RequestType,
    @Param('id') id: number,
  ): Promise<DeleteResult> {
    return this.definitionsService.deleteDefinitionById(req.user, id);
  }

  @Get(':id/country')
  async getDefinitionCountryById(@Param('id') id: number): Promise<Country> {
    return this.definitionsService.getDefinitionCountryById(id);
  }
}
