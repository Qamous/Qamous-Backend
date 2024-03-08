import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { WordReport } from '../../../typeorm/entities/word-report';
import { WordReportsService } from '../../services/word-reports/word-reports.service';
import { CreateWordReportDto } from '../../dtos/create-word-report.dto';

@Controller('word-reports')
export class WordReportsController {
  constructor(private wordReportsService: WordReportsService) {}

  @Post()
  async createWordReport(@Body() createWordReportDto: CreateWordReportDto) {
    return await this.wordReportsService.createWordReport(createWordReportDto);
  }

  @Get()
  async getWordReports(): Promise<WordReport[]> {
    return await this.wordReportsService.getWordReports();
  }

  @Get('word/:id')
  async getWordReportsByWordId(
    @Param('id', ParseIntPipe) wordId: number,
  ): Promise<WordReport[]> {
    return await this.wordReportsService.getWordReportsByWordId(wordId);
  }

  @Get(':id')
  async getWordReportById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<WordReport> {
    return await this.wordReportsService.getWordReportById(id);
  }

  @Delete(':id')
  async deleteWordReport(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return await this.wordReportsService.deleteWordReport(id);
  }
}
