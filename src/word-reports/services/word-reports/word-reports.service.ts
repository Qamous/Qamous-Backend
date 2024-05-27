import { HttpException, Injectable } from '@nestjs/common';
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
    user: User,
    reportDetails: CreateWordReportDto,
  ): Promise<WordReport> {
    const word: Word = await this.wordRepository.findOne({
      where: { id: reportDetails.wordId }, // Change wordId to wordID
    });
    if (!word) {
      throw new HttpException('Word not found', 404);
    }
    const newReport: WordReport = this.wordReportsRepository.create({
      ...reportDetails,
      userId: user.id,
      createdAt: new Date(),
    });
    return await this.wordReportsRepository.save(newReport);
  }

  async getWordReports(): Promise<WordReport[]> {
    return await this.wordReportsRepository.find();
  }

  async getWordReportsByWordId(wordId: number): Promise<WordReport[]> {
    return await this.wordReportsRepository.find({ where: { wordId } });
  }

  async getWordReportById(id: number): Promise<WordReport> {
    return await this.wordReportsRepository.findOne({ where: { id } });
  }

  async deleteWordReport(id: number): Promise<void> {
    await this.wordReportsRepository.delete({ id });
  }
}
