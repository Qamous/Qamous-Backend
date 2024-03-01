export function validateFields(password: string, firstName: string): void {
  isPasswordSecure(password, firstName);
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
 * - contain at least 5 unique characters
 * - not be "QamousPa$$w0rd", "qamousPa$$w0rd", or "Qamouspa$$w0rd"
 *
 * @param {string} password - the password to validate
 * @param {string} firstName - the first name of the user
 * @returns {void} - nothing
 */
function isPasswordSecure(password: string, firstName: string): void {
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const hasMinimumLength = password.length >= 12;
  const hasMaximumLength = password.length <= 100;

  const hasNoSpaces = !/\s/.test(password);
  const doesNotContainFirstName = !password.includes(firstName);

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
    case hasUniqueChars:
      throw new Error('Password must contain at least 5 unique characters');
    case isNotCommonPassword:
      throw new Error(password + ' is a common password');
  }

  return;
}
