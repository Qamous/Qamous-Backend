import { Test, TestingModule } from '@nestjs/testing';
import { DefinitionsService } from './definitions.service';

describe('DefinitionsService', () => {
  let service: DefinitionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DefinitionsService],
    }).compile();

    service = module.get<DefinitionsService>(DefinitionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
