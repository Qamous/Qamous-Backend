import { createHash, randomBytes } from 'crypto';

/*
 * This hashes a password using SHA-3-512, salts it, peppers it,
 * and returns the hashed password
 */
export function passwordHashing(password: string): string {
  const hash = createHash('sha3-512');
  const salt = randomBytes(16).toString('hex');
  hash.update(password + salt);
  // Generate a random letter
  const pepper = randomBytes(1).toString('hex');
  hash.update(pepper);
  return hash.digest('hex');
}
