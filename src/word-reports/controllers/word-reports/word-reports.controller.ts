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
import { LocalAuthGuard } from '../../../utils/local.guard';
import { RequestType } from 'express-serve-static-core';

@Controller('word-reports')
export class WordReportsController {
  constructor(private wordReportsService: WordReportsService) {}

  @UseGuards(LocalAuthGuard)
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

  @UseGuards(LocalAuthGuard) // Everything is excluded anyway
  @Get()
  async getWordReports(): Promise<WordReport[]> {
    return await this.wordReportsService.getWordReports();
  }

  @UseGuards(LocalAuthGuard)
  @Get('word/:id')
  async getWordReportsByWordId(
    @Param('id', ParseIntPipe) wordId: number,
  ): Promise<WordReport[]> {
    return await this.wordReportsService.getWordReportsByWordId(wordId);
  }

  @UseGuards(LocalAuthGuard)
  @Get(':id')
  async getWordReportById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<WordReport> {
    return await this.wordReportsService.getWordReportById(id);
  }

  @UseGuards(LocalAuthGuard)
  @Delete(':id')
  async deleteWordReport(
    @Request() req: RequestType,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return await this.wordReportsService.deleteWordReport(req.user, id);
  }
}
