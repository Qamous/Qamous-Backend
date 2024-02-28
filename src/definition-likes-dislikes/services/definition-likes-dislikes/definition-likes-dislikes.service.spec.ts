import { Test, TestingModule } from '@nestjs/testing';
import { DefinitionLikesDislikesService } from './definition-likes-dislikes.service';

describe('DefinitionLikesDislikesService', () => {
  let service: DefinitionLikesDislikesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DefinitionLikesDislikesService],
    }).compile();

    service = module.get<DefinitionLikesDislikesService>(DefinitionLikesDislikesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
