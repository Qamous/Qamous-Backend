import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { DefinitionReportsService } from '../../services/definition-reports/definition-reports.service';
import { CreateDefinitionReportDto } from '../../dtos/create-definition-report.dto';
import { UpdateDefinitionReportDto } from '../../dtos/update-definition-report.dto';

@Controller('definition-reports')
export class DefinitionReportsController {
  constructor(private definitionReportsService: DefinitionReportsService) {}

  @Post()
  createReport(@Body() dto: CreateDefinitionReportDto) {
    return this.definitionReportsService.createReport(dto);
  }

  @Patch(':id')
  updateReport(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDefinitionReportDto,
  ) {
    return this.definitionReportsService.updateReport(id, dto);
  }

  @Delete(':id')
  deleteReport(@Param('id', ParseIntPipe) id: number) {
    return this.definitionReportsService.deleteReport(id);
  }

  @Get(':id')
  getReportById(@Param('id', ParseIntPipe) id: number) {
    return this.definitionReportsService.getReportById(id);
  }

  @Get()
  getAllReports() {
    return this.definitionReportsService.getAllReports();
  }
}
