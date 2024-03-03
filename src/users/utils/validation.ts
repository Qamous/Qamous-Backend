// This file contains functions for validating user fields.
// It might be a good idea to move it to the front end in order to reduce
// the number of API calls and server load.

import { CreateUserDto } from '../dtos/create-user.dto';
import { UpdateUserDto } from '../dtos/update-user.dto';

/**
 * This function validates the fields of a user and throws an error if they are invalid.
 *
 * @param {CreateUserDto | UpdateUserDto} userDto - the fields of the user to validate
 * @returns {void} - nothing
 */
export function validateFields(userDto: CreateUserDto | UpdateUserDto): void {
  isNameValid(userDto.firstName, userDto.lastName);
  isEmailValid(userDto.email);
  isUsernameValid(userDto.username);
  isPasswordSecure(userDto.password, userDto.firstName, userDto.username);
  // Date of birth is optional
  if (userDto.dateOfBirth) {
    isDateValid(userDto.dateOfBirth);
  }
  return;
}

/**
 * This function validates that the user's name is valid and throws an error if it is not.
 * A valid name must:
 * - not be empty
 * - be at most 100 characters long
 *
 * @param {string} firstName - the first name to validate
 * @param {string} lastName - the last name to validate
 * @returns {void} - nothing
 */
function isNameValid(firstName: string, lastName: string): void {
  if (!firstName || !lastName || firstName === '' || lastName === '') {
    throw new Error('First name and last name are required');
  }
  if (firstName.length > 100) {
    throw new Error('First name is too long');
  }
  if (lastName.length > 100) {
    throw new Error('Last name is too long');
  }
  return;
}

/**
 * This function validates that an email is valid and throws an error if it is not.
 *
 * @param {string} email - the email to validate
 * @returns {void} - nothing
 */
function isEmailValid(email: string): void {
  if (!email || email === '') {
    throw new Error('Email is required');
  }
  const emailRegex = /^[^@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Email is not valid');
  }
  return;
}

/**
 * This function validates that a username is valid and throws an error if it is not.
 * A valid username must:
 * - not be empty
 * - be at most 100 characters long
 * - not contain spaces
 *
 * @param {string} username - the username to validate
 * @returns {void} - nothing
 */
function isUsernameValid(username: string): void {
  if (!username || username === '') {
    throw new Error('Username is required');
  }
  if (username.length > 100) {
    throw new Error('Username is too long');
  }
  if (username.includes(' ')) {
    throw new Error('Username must not contain spaces');
  }
  return;
}

/**
 * This function validates that a password is secure and throws an error if it is not.
 * A secure password must:
 * - contain at least one uppercase letter
 * - contain at least one lowercase letter
 * - contain at least one number
 * - contain at least one special character
 * - be at least 12 characters long
 * - be at most 100 characters long
 * - not contain spaces
 * - not contain the user's first name
 * - not contain the user's username
 * - contain at least 5 unique characters
 * - not be "QamousPa$$w0rd", "qamousPa$$w0rd", or "Qamouspa$$w0rd"
 *
 * @param {string} password - the password to validate
 * @param {string} firstName - the first name of the user
 * @param {string} userName - the username of the user
 * @returns {void} - nothing
 */
function isPasswordSecure(
  password: string,
  firstName: string,
  userName: string,
): void {
  if (!password || password === '') {
    throw new Error('Password is required');
  }
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const hasMinimumLength = password.length >= 12;
  const hasMaximumLength = password.length <= 100;

  const hasNoSpaces = !/\s/.test(password);
  const doesNotContainFirstName = !password.includes(firstName);
  const doesNotContainUsername = !password.includes(userName);

  // Password has 5 or more unique characters
  const uniqueChars: Set<string> = new Set(password);
  const hasUniqueChars = uniqueChars.size >= 5;

  // is not "QamousPa$$w0rd" or "qamousPa$$w0rd" or "Qamouspa$$w0rd"
  const isNotCommonPassword = ![
    'QamousPa$$w0rd',
    'qamousPa$$w0rd',
    'Qamouspa$$w0rd',
  ].includes(password);

  switch (false) {
    case hasUpperCase:
      throw new Error('Password must contain at least one uppercase letter');
    case hasLowerCase:
      throw new Error('Password must contain at least one lowercase letter');
    case hasNumber:
      throw new Error('Password must contain at least one number');
    case hasSpecialChar:
      throw new Error('Password must contain at least one special character');
    case hasMinimumLength:
      throw new Error('Password must be at least 12 characters long');
    case hasMaximumLength:
      throw new Error('Password must be at most 100 characters long');
    case hasNoSpaces:
      throw new Error('Password must not contain spaces');
    case doesNotContainFirstName:
      throw new Error('Password must not contain first name');
    case doesNotContainUsername:
      throw new Error('Password must not contain username');
    case hasUniqueChars:
      throw new Error('Password must contain at least 5 unique characters');
    case isNotCommonPassword:
      throw new Error(password + ' is a common password');
  }
  return;
}

/**
 * This function validates that a date is valid and throws an error if it is not.
 * A valid date must:
 * - be over 3 years ago
 *
 * @param {Date} date - the date to validate
 * @returns {void} - nothing
 */
function isDateValid(date: Date): void {
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  // If the date is in the future, throw an error
  if (date > new Date()) {
    throw new Error('Date of birth cannot be in the future');
  }
  // If the date is not over 3 years ago, throw an error
  if (date >= threeYearsAgo) {
    throw new Error('Date of birth must be over 3 years ago');
  }
  return;
}
