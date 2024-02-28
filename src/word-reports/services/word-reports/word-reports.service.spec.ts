import { Test, TestingModule } from '@nestjs/testing';
import { WordReportsService } from './word-reports.service';

describe('WordReportsService', () => {
  let service: WordReportsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WordReportsService],
    }).compile();

    service = module.get<WordReportsService>(WordReportsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
