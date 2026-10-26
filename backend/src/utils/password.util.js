const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 10;

/**
 * Hash a plain text password using bcrypt
 * @param {string} plainPassword 
 * @returns {Promise<string>}
 */
async function hashPassword(plainPassword) {
  if (!plainPassword || typeof plainPassword !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
  return bcrypt.hash(plainPassword, salt);
}

/**
 * Compare a candidate plain text password with a bcrypt hash
 * @param {string} candidatePassword 
 * @param {string} hashedPassword 
 * @returns {Promise<boolean>}
 */
async function comparePassword(candidatePassword, hashedPassword) {
  if (!candidatePassword || !hashedPassword) {
    return false;
  }
  return bcrypt.compare(candidatePassword, hashedPassword);
}

module.exports = {
  hashPassword,
  comparePassword,
  BCRYPT_ROUNDS
};

