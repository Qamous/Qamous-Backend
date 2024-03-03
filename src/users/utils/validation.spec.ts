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
    it('should throw an error if email contains spaces', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe @example.com', // Spaces in email
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2001-09-11'),
      };
      expect(() => validateFields(userDto)).toThrow(
        'Email must not contain spaces',
      );
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

  // This is a test suite for the validateFields username validation
  describe('validateFields for username', () => {
    it('should throw an error if username is empty', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: '',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow('Username is required');
    });
    it('should throw an error if username is too long', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'a'.repeat(101),
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow('Username is too long');
    });
    it('should throw an error if username contains spaces', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'john doe', // Spaces
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow(
        'Username must not contain spaces',
      );
    });
    it('should not throw an error if username is valid', () => {
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

  // This is a test suite for the validateFields password validation
  describe('validateFields for password', () => {
    it('should throw an error if password is empty', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: '',
        passwordConfirmation: '',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow('Password is required');
    });
    it('should throw an error if password does not contain at least one uppercase letter', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'password123!',
        passwordConfirmation: 'password123!',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow(
        'Password must contain at least one uppercase letter',
      );
    });
    it('should throw an error if password does not contain at least one lowercase letter', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'PASSWORD123!',
        passwordConfirmation: 'PASSWORD123!',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow(
        'Password must contain at least one lowercase letter',
      );
    });
    it('should throw an error if password does not contain at least one number', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'PasswordPassword!',
        passwordConfirmation: 'PasswordPassword!',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow(
        'Password must contain at least one number',
      );
    });
    it('should throw an error if password does not contain at least one special character', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'Password1234',
        passwordConfirmation: 'Password1234',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow(
        'Password must contain at least one special character',
      );
    });
    it('should throw an error if password is less than 12 characters long', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'Pass123!',
        passwordConfirmation: 'Pass123!',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow(
        'Password must be at least 12 characters long',
      );
    });
    it('should throw an error if password is more than 100 characters long', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'Pa1!'.repeat(25) + '1',
        passwordConfirmation: 'P'.repeat(25) + '1',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow(
        'Password must be at most 100 characters long',
      );
    });
    it('should throw an error if password contains spaces', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'Password 123!',
        passwordConfirmation: 'Password 123!',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow(
        'Password must not contain spaces',
      );
    });
    it("should throw an error if password contains the user's first name", () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'JohnPassword123!',
        passwordConfirmation: 'JohnPassword123!',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow(
        'Password must not contain first name',
      );
    });
    it("should throw an error if password contains the user's username", () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'johndoePass123!',
        passwordConfirmation: 'johndoePass123!',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow(
        'Password must not contain username',
      );
    });
    it('should throw an error if password does not contain at least 5 unique characters', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'AAAaa11111!!!',
        passwordConfirmation: 'AAAaa11111!!!',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow(
        'Password must contain at least 5 unique characters',
      );
    });
    it('should throw an error if password is a common password', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'QamousPa$$w0rd',
        passwordConfirmation: 'QamousPa$$w0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow(
        'QamousPa$$w0rd is a common password',
      );
    });
    it('should throw an error if password is "qamousPa$$w0rd"', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'qamousPa$$w0rd',
        passwordConfirmation: 'qamousPa$$w0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow(
        'qamousPa$$w0rd is a common password',
      );
    });
    it('should throw an error if password is "Qamouspa$$w0rd"', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'Qamouspa$$w0rd',
        passwordConfirmation: 'Qamouspa$$w0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2000-01-01'),
      };
      expect(() => validateFields(userDto)).toThrow(
        'Qamouspa$$w0rd is a common password',
      );
    });
    it('should not throw an error if password is valid', () => {
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

  // This is a test suite for the validateFields date of birth validation
  describe('validateFields for dateOfBirth', () => {
    // TODO: does the date of birth need to be provided?
    it('should not throw an error if dateOfBirth is not provided / null', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: null,
      };
      expect(() => validateFields(userDto)).not.toThrow();
    });
    it('should throw an error if dateOfBirth is in the future', () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1); // 1 year in the future

      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: futureDate,
      };
      expect(() => validateFields(userDto)).toThrow(
        'Date of birth cannot be in the future',
      );
    });
    it('should throw an error if dateOfBirth is less than 3 years ago', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: new Date(), // Today's date
      };
      expect(() => validateFields(userDto)).toThrow(
        'Date of birth must be over 3 years ago',
      );
    });
    it('should throw an error if dateOfBirth is 2 years ago', () => {
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2); // 2 years ago

      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: twoYearsAgo,
      };
      expect(() => validateFields(userDto)).toThrow(
        'Date of birth must be over 3 years ago',
      );
    });
    it('should throw an error if dateOfBirth is exactly 3 years ago', () => {
      const threeYearsAgo = new Date();
      threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);

      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: threeYearsAgo,
      };
      expect(() => validateFields(userDto)).toThrow(
        'Date of birth must be over 3 years ago',
      );
    });
    it('should not throw an error if dateOfBirth is more than 3 years ago', () => {
      const dateOfBirth = new Date();
      dateOfBirth.setFullYear(dateOfBirth.getFullYear() - 4); // 4 years ago

      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: dateOfBirth,
      };
      expect(() => validateFields(userDto)).not.toThrow();
    });
    it('should not throw an error if dateOfBirth is 9/11/2001 (My DOB)', () => {
      const userDto: CreateUserDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        username: 'johndoe',
        password: 'SecureP@ssw0rd',
        passwordConfirmation: 'SecureP@ssw0rd',
        createdAt: new Date(),
        dateOfBirth: new Date('2001-09-11'),
      };
      expect(() => validateFields(userDto)).not.toThrow();
    });
  });
});
