import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { WordReport } from '../../../typeorm/entities/word-report';
import { WordReportsService } from '../../services/word-reports/word-reports.service';
import { CreateWordReportDto } from '../../dtos/create-word-report.dto';
import { AuthenticatedGuard } from '../../../utils/guards/local.guard';
import { RequestType } from 'express-serve-static-core';

@Controller('word-reports')
export class WordReportsController {
  constructor(private wordReportsService: WordReportsService) {}

  @Post()
  async createWordReport(
    @Request() req: RequestType,
    @Body() createWordReportDto: CreateWordReportDto,
  ): Promise<WordReport> {
    return await this.wordReportsService.createWordReport(
      req.user,
      createWordReportDto,
    );
  }

  @UseGuards(AuthenticatedGuard) // Everything is excluded anyway
  @Get()
  async getWordReports(): Promise<WordReport[]> {
    return await this.wordReportsService.getWordReports();
  }

  @UseGuards(AuthenticatedGuard)
  @Get('word/:id')
  async getWordReportsByWordId(
    @Param('id', ParseIntPipe) wordId: number,
  ): Promise<WordReport[]> {
    return await this.wordReportsService.getWordReportsByWordId(wordId);
  }

  @UseGuards(AuthenticatedGuard)
  @Get(':id')
  async getWordReportById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<WordReport> {
    return await this.wordReportsService.getWordReportById(id);
  }

  @UseGuards(AuthenticatedGuard)
  @Delete(':id')
  async deleteWordReport(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return await this.wordReportsService.deleteWordReport(id);
  }
}
