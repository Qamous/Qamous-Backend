import { Test, TestingModule } from '@nestjs/testing';
import { DefinitionLikesDislikesController } from './definition-likes-dislikes.controller';

describe('DefinitionLikesDislikesController', () => {
  let controller: DefinitionLikesDislikesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DefinitionLikesDislikesController],
    }).compile();

    controller = module.get<DefinitionLikesDislikesController>(DefinitionLikesDislikesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
