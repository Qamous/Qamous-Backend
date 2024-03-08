import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WordReport } from '../../../typeorm/entities/word-report';
import { Repository } from 'typeorm';
import { CreateWordReportDto } from '../../dtos/create-word-report.dto';
import { Word } from '../../../typeorm/entities/word';
import { User } from '../../../typeorm/entities/user';

@Injectable()
export class WordReportsService {
  constructor(
    @InjectRepository(WordReport)
    private wordReportsRepository: Repository<WordReport>,
    @InjectRepository(Word)
    private wordRepository: Repository<Word>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async createWordReport(
    createWordReportDto: CreateWordReportDto,
  ): Promise<WordReport> {
    const word = await this.wordRepository.findOne({
      where: { id: createWordReportDto.wordID },
    });
    const reportingUser = await this.userRepository.findOne({
      where: { id: createWordReportDto.userReportingID },
    });
    const reportedUser = await this.userRepository.findOne({
      where: { id: createWordReportDto.userReportedID },
    });

    const newWordReport = new WordReport();
    newWordReport.word = word;
    newWordReport.reportingUser = reportingUser;
    newWordReport.reportedUser = reportedUser;
    newWordReport.reportText = createWordReportDto.reportText;
    newWordReport.AddedTimestamp = createWordReportDto.createdAt;

    await this.wordReportsRepository.save(newWordReport);
    return newWordReport;
  }

  async getWordReports(): Promise<WordReport[]> {
    return await this.wordReportsRepository.find();
  }

  async getWordReportsByWordId(wordId: number): Promise<WordReport[]> {
    return await this.wordReportsRepository.find({
      where: { word: { id: wordId } },
    });
  }

  async getWordReportById(id: number): Promise<WordReport> {
    return await this.wordReportsRepository.findOne({
      where: { id },
    });
  }

  async deleteWordReport(id: number): Promise<void> {
    await this.wordReportsRepository.delete(id);
  }
}
