import { Test, TestingModule } from '@nestjs/testing';
import { DefinitionReportsController } from './definition-reports.controller';

describe('DefinitionReportsController', () => {
  let controller: DefinitionReportsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DefinitionReportsController],
    }).compile();

    controller = module.get<DefinitionReportsController>(DefinitionReportsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
