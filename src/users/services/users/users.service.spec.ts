import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { Repository } from 'typeorm';
import { User } from '../../../typeorm/entities/user';
import { getRepositoryToken } from '@nestjs/typeorm';
import { newPasswordHashing } from '../../../../safe/new-password-hashing';
import { UpdateUserParams } from '../../../utils/types';

describe('UsersService', () => {
  let service: UsersService;
  let mockRepository: Partial<Record<keyof Repository<User>, jest.Mock>>;
  let newPasswordHashingMock: jest.Mock;

  beforeEach(async () => {
    mockRepository = {
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findOne: jest.fn(),
    };

    newPasswordHashingMock = jest.fn();

    // This provides mock implementations for the UsersService's dependencies
    // (It creates mock implementations for the User repository and the newPasswordHashing function)
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockRepository,
        },
        {
          provide: newPasswordHashing,
          useValue: newPasswordHashingMock,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findUsers', () => {
    it('should return all users', async () => {
      const users = [{ id: 1 }, { id: 2 }];
      mockRepository.find.mockResolvedValue(users);

      expect(await service.findUsers()).toEqual(users);
      expect(mockRepository.find).toHaveBeenCalled();
    });
  });

  describe('updateUser', () => {
    it('should update a user', async () => {
      const id = 1;
      const updateUserDetails: UpdateUserParams = { firstName: 'newFirstName' };
      const updateResult = { affected: 1 };
      mockRepository.update.mockResolvedValue(updateResult);

      expect(await service.updateUser(id, updateUserDetails)).toEqual(
        updateResult,
      );
      expect(mockRepository.update).toHaveBeenCalledWith(
        { id },
        updateUserDetails,
      );
    });

    it('should throw an error if user not found', async () => {
      const id = 1;
      const updateUserDetails: UpdateUserParams = { firstName: 'newFirstName' };
      const updateResult = { affected: 0 };
      mockRepository.update.mockResolvedValue(updateResult);

      await expect(service.updateUser(id, updateUserDetails)).rejects.toThrow();
      expect(mockRepository.update).toHaveBeenCalledWith(
        { id },
        updateUserDetails,
      );
    });
  });

  describe('deleteUser', () => {
    it('should delete a user', async () => {
      const id = 1;
      const deleteResult = { affected: 1 };
      mockRepository.delete.mockResolvedValue(deleteResult);

      expect(await service.deleteUser(id)).toEqual(deleteResult);
      expect(mockRepository.delete).toHaveBeenCalledWith({ id });
    });
  });

  describe('findUserById', () => {
    it('should return a user by id', async () => {
      const id = 1;
      const user = { id };
      mockRepository.findOne.mockResolvedValue(user);

      expect(await service.findUserById(id)).toEqual(user);
      expect(mockRepository.findOne).toHaveBeenCalledWith({ where: { id } });
    });
  });
});
