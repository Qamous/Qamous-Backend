import { Test, TestingModule } from '@nestjs/testing';
import { DefinitionLikesDislikesService } from './definition-likes-dislikes.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DefinitionLikeDislike } from '../../../typeorm/entities/definition-like-dislike';
import { DefinitionsService } from '../../../definitions/services/definitions/definitions.service';
import { Repository, EntityManager, QueryRunner } from "typeorm";
import { User } from '../../../typeorm/entities/user';
import { Definition } from '../../../typeorm/entities/definition';

describe('DefinitionLikesDislikesService', () => {
  let service: DefinitionLikesDislikesService;
  let definitionLikesDislikesRepository: Repository<DefinitionLikeDislike>;
  let definitionsService: DefinitionsService;

  const mockUser: User = {
    id: 1,
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
    username: 'testuser',
    password: 'password',
    dateOfBirth: new Date(),
    profilePicture: null,
    likesReceived: 0,
    points: 0,
    createdAt: new Date(),
    country: null,
    definitions: [],
    words: []
  };

  const mockDefinition: Definition = {
    id: 1,
    wordId: 1,
    userId: 2, // Different from mockUser.id
    countryCode: 'US',
    definition: 'Test definition',
    example: 'Test example',
    isArabic: true,
    AddedTimestamp: new Date(),
    likeCount: 0,
    dislikeCount: 0,
    reportCount: 0,
    word: null,
    user: null,
    country: null
  };

  const mockReaction: DefinitionLikeDislike = {
    id: 1,
    definition: mockDefinition,
    user: mockUser,
    definitionId: 1,
    userId: 1,
    liked: true,
    createdAt: new Date()
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DefinitionLikesDislikesService,
        {
          provide: getRepositoryToken(DefinitionLikeDislike),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
            create: jest.fn(),
            delete: jest.fn(),
            manager: {
              transaction: jest.fn((callback) => callback({
                findOne: jest.fn(),
                save: jest.fn(),
                increment: jest.fn(),
                decrement: jest.fn(),
              })),
            },
          },
        },
        {
          provide: DefinitionsService,
          useValue: {
            getDefinitionById: jest.fn(),
            findOne: jest.fn(),
            incrementLikeCount: jest.fn(),
            decrementLikeCount: jest.fn(),
            incrementDislikeCount: jest.fn(),
            decrementDislikeCount: jest.fn(),

          },
        },
      ],
    }).compile();

    service = module.get<DefinitionLikesDislikesService>(DefinitionLikesDislikesService);
    definitionLikesDislikesRepository = module.get<Repository<DefinitionLikeDislike>>(
      getRepositoryToken(DefinitionLikeDislike),
    );
    definitionsService = module.get<DefinitionsService>(DefinitionsService);
  });

  describe('validateReactionRequest', () => {
    it('should reject unauthenticated users', async () => {
      const result = await service['validateReactionRequest'](null, 1);
      expect(result.isValid).toBeFalsy();
      expect(result.message).toBe('User must be authenticated');
    });

    it('should reject non-existent definitions', async () => {
      jest.spyOn(definitionsService, 'getDefinitionById').mockResolvedValue(null);

      const result = await service['validateReactionRequest'](mockUser, 999);
      expect(result).toEqual({
        isValid: false,
        message: 'Definition not found'
      });
    });

    it('should reject self-reactions', async () => {
      const selfDefinition = { ...mockDefinition, userId: mockUser.id };
      jest.spyOn(definitionsService, 'getDefinitionById').mockResolvedValue(selfDefinition);

      const result = await service['validateReactionRequest'](mockUser, 1);
      expect(result.isValid).toBeFalsy();
      expect(result.message).toBe('You cannot react to your own definitions');
    });

    it('should accept valid reaction requests', async () => {
      jest.spyOn(definitionsService, 'getDefinitionById').mockResolvedValue(mockDefinition);

      const result = await service['validateReactionRequest'](mockUser, 1);
      expect(result.isValid).toBeTruthy();
      expect(result.definition).toBeDefined();
    });
  });

  describe('handlePointUpdate', () => {
    const mockEntityManager = {
      getRepository: jest.fn().mockReturnValue({
        increment: jest.fn(),
      }),
    } as unknown as EntityManager;

    it('should not update points for self-reactions', async () => {
      await service['handlePointUpdate'](
        mockEntityManager,
        1,
        1, // Same user IDs
        true,
        null
      );

      expect(mockEntityManager.getRepository).not.toHaveBeenCalled();
    });

    it('should add 1 point for new like', async () => {
      await service['handlePointUpdate'](
        mockEntityManager,
        1,
        2,
        true,
        null
      );

      expect(mockEntityManager.getRepository).toHaveBeenCalled();
      expect(mockEntityManager.getRepository(User).increment)
        .toHaveBeenCalledWith({ id: 2 }, 'points', 1);
    });

    it('should subtract 1 point for new dislike', async () => {
      await service['handlePointUpdate'](
        mockEntityManager,
        1,
        2,
        false,
        null
      );

      expect(mockEntityManager.getRepository(User).increment)
        .toHaveBeenCalledWith({ id: 2 }, 'points', -1);
    });

    it('should add 2 points when switching from dislike to like', async () => {
      const existingDislike = { ...mockReaction, liked: false };

      await service['handlePointUpdate'](
        mockEntityManager,
        1,
        2,
        true,
        existingDislike
      );

      expect(mockEntityManager.getRepository(User).increment)
        .toHaveBeenCalledWith({ id: 2 }, 'points', 2);
    });

    it('should subtract 2 points when switching from like to dislike', async () => {
      const existingLike = { ...mockReaction, liked: true };

      await service['handlePointUpdate'](
        mockEntityManager,
        1,
        2,
        false,
        existingLike
      );

      expect(mockEntityManager.getRepository(User).increment)
        .toHaveBeenCalledWith({ id: 2 }, 'points', -2);
    });
  });

  describe('Race Condition Scenarios', () => {
    let queryRunner: QueryRunner;

    beforeEach(() => {
      queryRunner = {
        manager: {
          getRepository: jest.fn().mockReturnValue({
            findOne: jest.fn(),
            save: jest.fn(),
            increment: jest.fn(),
            decrement: jest.fn(),
          }),
        },
        connect: jest.fn(),
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
      } as unknown as QueryRunner;
    });

    describe('Concurrent Reactions', () => {
      it('should handle concurrent likes from different users', async () => {
        const transactionMock = jest.fn((callback) => callback({
          findOne: jest.fn().mockResolvedValue(null),
          save: jest.fn().mockResolvedValue(mockReaction),
        }));

        jest.spyOn(definitionLikesDislikesRepository.manager, 'transaction')
          .mockImplementation(transactionMock);

        const user1 = { ...mockUser, id: 1 };
        const user2 = { ...mockUser, id: 2 };

        const like1Promise = service.handleReaction(user1, mockDefinition.id, true);
        const like2Promise = service.handleReaction(user2, mockDefinition.id, true);

        await expect(Promise.all([like1Promise, like2Promise])).resolves.toBeDefined();
        expect(transactionMock).toHaveBeenCalledTimes(2);
      });

      it('should prevent duplicate reactions within transaction', async () => {
        const transactionMock = jest.fn((callback) => callback({
          findOne: jest.fn().mockResolvedValue(mockReaction), // Simulate existing reaction
          save: jest.fn(),
        }));

        jest.spyOn(definitionLikesDislikesRepository.manager, 'transaction')
          .mockImplementation(transactionMock);

        await expect(service.handleReaction(mockUser, mockDefinition.id, true))
          .resolves.toEqual({
            success: false,
            message: 'Definition not found'
          });
      });
    });;

    describe('Deadlock Prevention', () => {
      it('should handle multiple reaction switches without deadlock', async () => {
        const user1 = { ...mockUser, id: 1 };
        const user2 = { ...mockUser, id: 2 };
        const definition1 = { ...mockDefinition, id: 1 };
        const definition2 = { ...mockDefinition, id: 2 };

        // Simulate potential deadlock scenario with crossing reactions
        const promises = [
          service.handleReaction(user1, definition1.id, true),
          service.handleReaction(user1, definition2.id, false),
          service.handleReaction(user2, definition1.id, false),
          service.handleReaction(user2, definition2.id, true),
        ];

        await expect(Promise.all(promises)).resolves.toBeDefined();
      });

      it('should handle rapid reaction toggles from same user', async () => {
        const togglePromises = Array(5).fill(null).map((_, index) =>
          service.handleReaction(mockUser, mockDefinition.id, index % 2 === 0)
        );

        const results = await Promise.all(togglePromises);
        expect(results).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              message: 'Definition not found',
              success: false
            })
          ])
        );
      });
    });
  });
});