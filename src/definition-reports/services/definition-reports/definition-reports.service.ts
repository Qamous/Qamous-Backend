import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DefinitionReport } from '../../../typeorm/entities/definition-report';
import { CreateDefinitionReportDto } from '../../dtos/create-definition-report.dto';
import { UpdateDefinitionReportDto } from '../../dtos/update-definition-report.dto';
import { User } from '../../../typeorm/entities/user';

@Injectable()
export class DefinitionReportsService {
  constructor(
    @InjectRepository(DefinitionReport)
    private definitionReportsRepository: Repository<DefinitionReport>,
  ) {}

  async createReport(
    user: User,
    reportDetails: CreateDefinitionReportDto,
  ): Promise<DefinitionReport> {
    const newReport: DefinitionReport = this.definitionReportsRepository.create(
      {
        ...reportDetails,
        userId: user.id,
        createdAt: new Date(),
      },
    );
    return await this.definitionReportsRepository.save(newReport);
  }

  async updateReport(
    id: number,
    reportDetails: UpdateDefinitionReportDto,
  ): Promise<DefinitionReport> {
    const report: DefinitionReport =
      await this.definitionReportsRepository.findOne({
        where: { id },
      });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    const updatedReport = await this.definitionReportsRepository.save({
      ...report,
      ...reportDetails,
    });
    return updatedReport;
  }

  async deleteReport(id: number) {
    const report = await this.definitionReportsRepository.findOne({
      where: { id },
    });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    await this.definitionReportsRepository.delete(id);
  }

  async getReportById(id: number) {
    const report = await this.definitionReportsRepository.findOne({
      where: { id },
    });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    return report;
  }

  async getAllReports() {
    return await this.definitionReportsRepository.find();
  }

  async getReportsByUserId(userId: number) {
    return await this.definitionReportsRepository.find({ where: { userId } });
  }

  async getReportsByDefinitionId(definitionId: number) {
    return await this.definitionReportsRepository.find({
      where: { definitionId },
    });
  }
}
