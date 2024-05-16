import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DefinitionReport } from '../typeorm/entities/definition-report';
import { DefinitionReportsService } from './services/definition-reports/definition-reports.service';
import { DefinitionReportsController } from './controllers/definition-reports/definition-reports.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DefinitionReport])],
  controllers: [DefinitionReportsController],
  providers: [DefinitionReportsService],
  exports: [DefinitionReportsService],
})
export class DefinitionReportsModule {}
