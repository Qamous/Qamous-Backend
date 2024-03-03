import { validateFields } from './validation';
import { CreateUserDto } from '../dtos/create-user.dto';
import { UpdateUserDto } from '../dtos/update-user.dto';

describe('Validation', () => {
  // This is a test suite for the validateFields name validation
  describe('validateFields for name', () => {
    it('should throw an error if first name is empty in CreateUserDto', () => {
      const userDto: CreateUserDto = {
        firstName: '',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow(
        'First name and last name are required',
      );
    });
    it('should throw an error if last name is empty in UpdateUserDto', () => {
      const userDto: UpdateUserDto = {
        firstName: 'John',
        lastName: '',
        email: 'john.doe@example.com',
        username: 'johndoe',
        oldPassword: 'OldP@ssw0rd',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow(
        'First name and last name are required',
      );
    });
    it('should throw an error if first name is too long', () => {
      const userDto: CreateUserDto = {
        firstName: 'a'.repeat(256),
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow('First name is too long');
    });
    it('should throw an error if last name is too long', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'D'.repeat(101),
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow('Last name is too long');
    });
    it('should not throw an error if first and last name are valid', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).not.toThrow();
    });
    it('should not throw an error if first or last name have a space', () => {
      const userDto: CreateUserDto = {
        firstName: 'Anthony Youssef',
        lastName: 'Elkommos Youssef',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).not.toThrow();
    });
  });

  // This is a test suite for the validateFields email validation
  describe('validateFields for email', () => {
    it('should throw an error if email is empty', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: '',
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow('Email is required');
    });
    it('should throw an error if email format is invalid', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'invalidEmailFormat',
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow('Email is not valid');
    });
    it('should throw an error if email format is invalid but has an @', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'invalidEmail@Format',
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow('Email is not valid');
    });
    it('should throw an error if email format is invalid but has a .com at the end', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'invalidEmailFormat.com',
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow('Email is not valid');
    });
    it('should not throw an error if email format is valid', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).not.toThrow();
    });
  });
});
