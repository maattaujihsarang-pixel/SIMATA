const crypto = require('crypto');

function generateUUID() {
  return crypto.randomUUID();
}

function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function generateTeacherId(sequence) {
  const padded = String(sequence).padStart(4, '0');
  return `TCH-${padded}`;
}

function generateStudentId(sequence, level = 10) {
  const padded = String(sequence).padStart(5, '0');
  return `STD-K${level}${padded}`;
}

function generateQRCodeId() {
  const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `SQR-${randomHex}`;
}

module.exports = {
  generateUUID,
  generateToken,
  generateTeacherId,
  generateStudentId,
  generateQRCodeId
};

