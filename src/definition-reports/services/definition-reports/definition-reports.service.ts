import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DefinitionReport } from '../../../typeorm/entities/definition-report';
import { CreateDefinitionReportDto } from '../../dtos/create-definition-report.dto';
import { UpdateDefinitionReportDto } from '../../dtos/update-definition-report.dto';

@Injectable()
export class DefinitionReportsService {
  constructor(
    @InjectRepository(DefinitionReport)
    private definitionReportsRepository: Repository<DefinitionReport>,
  ) {}

  async createReport(
    dto: CreateDefinitionReportDto,
  ): Promise<DefinitionReport> {
    const report: DefinitionReport = new DefinitionReport();
    Object.assign(report, dto);
    return await this.definitionReportsRepository.save(report);
  }

  async updateReport(
    id: number,
    dto: UpdateDefinitionReportDto,
  ): Promise<DefinitionReport> {
    const updatedReport = await this.definitionReportsRepository.preload({
      id,
      ...dto,
    });

    if (!updatedReport) {
      throw new NotFoundException(`Report with ID ${id} not found`);
    }

    return await this.definitionReportsRepository.save(updatedReport);
  }

  async deleteReport(id: number): Promise<void> {
    const deleteResult = await this.definitionReportsRepository.delete(id);

    if (!deleteResult.affected) {
      throw new NotFoundException(`Report with ID ${id} not found`);
    }
  }

  async getReportById(id: number): Promise<DefinitionReport> {
    const report: DefinitionReport =
      await this.definitionReportsRepository.findOne({
        where: { id },
      });

    if (!report) {
      throw new NotFoundException(`Report with ID ${id} not found`);
    }

    return report;
  }

  async getAllReports(): Promise<DefinitionReport[]> {
    return await this.definitionReportsRepository.find();
  }
}
