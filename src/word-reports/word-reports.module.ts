import { Module } from '@nestjs/common';
import { WordReportsController } from './controllers/word-reports/word-reports.controller';
import { WordReportsService } from './services/word-reports/word-reports.service';

@Module({
  controllers: [WordReportsController],
  providers: [WordReportsService]
})
export class WordReportsModule {}
