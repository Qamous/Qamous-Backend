/**
 * This function validates that a password is secure and throws an error if it is not.
 * A secure password must:
 * - contain at least one uppercase letter
 * - contain at least one lowercase letter
 * - contain at least one number
 * - contain at least one special character
 * - be at least 12 characters long
 * - contain at least 5 unique characters
 * - not contain the user's first name
 *
 * @param {string} password - the password to validate
 * @param {string} firstName - the first name of the user
 * @returns {void} - nothing
 */
export function isPasswordSecure(password: string, firstName: string): void {
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const hasMinimumLength = password.length >= 12;
  const doesNotContainFirstName = !password.includes(firstName);

  // Password has 5 or more unique characters
  const uniqueChars: Set<string> = new Set(password);
  const hasUniqueChars = uniqueChars.size >= 5;

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
    case hasUniqueChars:
      throw new Error('Password must contain at least 5 unique characters');
    case doesNotContainFirstName:
      throw new Error('Password must not contain first name');
  }

  return;
}
