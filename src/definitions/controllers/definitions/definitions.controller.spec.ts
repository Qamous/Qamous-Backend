import { Test, TestingModule } from '@nestjs/testing';
import { DefinitionsController } from './definitions.controller';

describe('DefinitionsController', () => {
  let controller: DefinitionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DefinitionsController],
    }).compile();

    controller = module.get<DefinitionsController>(DefinitionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
