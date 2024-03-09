import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WordReport } from '../typeorm/entities/word-report';
import { WordReportsController } from './controllers/word-reports/word-reports.controller';
import { WordReportsService } from './services/word-reports/word-reports.service';
import { Word } from '../typeorm/entities/word';
import { User } from '../typeorm/entities/user';

@Module({
  imports: [TypeOrmModule.forFeature([WordReport, Word, User])], // WordReportRepository is provided here
  controllers: [WordReportsController],
  providers: [WordReportsService],
})
export class WordReportsModule {}
