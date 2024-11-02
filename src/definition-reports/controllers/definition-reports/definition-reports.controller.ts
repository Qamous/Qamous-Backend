import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { DefinitionReportsService } from '../../services/definition-reports/definition-reports.service';
import { CreateDefinitionReportDto } from '../../dtos/create-definition-report.dto';
import { UpdateDefinitionReportDto } from '../../dtos/update-definition-report.dto';
import { AuthenticatedGuard } from '../../../utils/local.guard';
import { RequestType } from 'express-serve-static-core';
import { DefinitionReport } from '../../../typeorm/entities/definition-report';

@Controller('definition-reports')
export class DefinitionReportsController {
  constructor(private definitionReportsService: DefinitionReportsService) {}

  @Post('')
  createReport(
    @Request() req: RequestType,
    @Body() reportDetails: CreateDefinitionReportDto,
  ): Promise<DefinitionReport> {
    return this.definitionReportsService.createReport(req.user, reportDetails);
  }

  @UseGuards(AuthenticatedGuard)
  @Patch(':id')
  updateReport(
    @Param('id', ParseIntPipe) id: number,
    @Body() reportDetails: UpdateDefinitionReportDto,
  ): Promise<DefinitionReport> {
    return this.definitionReportsService.updateReport(id, reportDetails);
  }

  @UseGuards(AuthenticatedGuard)
  @Delete(':id')
  deleteReport(@Param('id', ParseIntPipe) id: number) {
    return this.definitionReportsService.deleteReport(id);
  }

  @UseGuards(AuthenticatedGuard)
  @Get(':id')
  getReportById(@Param('id', ParseIntPipe) id: number) {
    return this.definitionReportsService.getReportById(id);
  }

  @UseGuards(AuthenticatedGuard)
  @Get()
  getAllReports() {
    return this.definitionReportsService.getAllReports();
  }
}
