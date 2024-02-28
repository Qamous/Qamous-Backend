import { Test, TestingModule } from '@nestjs/testing';
import { WordReportsController } from './word-reports.controller';

describe('WordReportsController', () => {
  let controller: WordReportsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WordReportsController],
    }).compile();

    controller = module.get<WordReportsController>(WordReportsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
