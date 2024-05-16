import { Test, TestingModule } from '@nestjs/testing';
import { DefinitionReportsService } from './definition-reports.service';

describe('DefinitionReportsService', () => {
  let service: DefinitionReportsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DefinitionReportsService],
    }).compile();

    service = module.get<DefinitionReportsService>(DefinitionReportsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
