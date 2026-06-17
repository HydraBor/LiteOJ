const bcrypt = require('bcryptjs');

const BCRYPT_PREFIX_RE = /^\$2[aby]\$\d{2}\$/;
const DEFAULT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);

function isBcryptHash(value) {
  return BCRYPT_PREFIX_RE.test(String(value || ''));
}

function hashPassword(password) {
  return bcrypt.hashSync(String(password || ''), DEFAULT_ROUNDS);
}

function verifyPassword(password, storedHash) {
  const plain = String(password || '');
  const stored = String(storedHash || '');
  if (!stored) return { ok: false, shouldUpgrade: false };
  if (isBcryptHash(stored)) {
    return { ok: bcrypt.compareSync(plain, stored), shouldUpgrade: false };
  }
  // Compatibility path for existing databases that contain plaintext passwords:
  // allow one successful login/change and let the caller immediately replace it
  // with a bcrypt hash.
  return { ok: plain === stored, shouldUpgrade: plain === stored };
}

function validateNewPassword(password) {
  const value = String(password || '');
  if (value.length < 6) return '新密码长度至少 6 位';
  if (value.length > 128) return '新密码长度不能超过 128 位';
  return '';
}

module.exports = {
  hashPassword,
  verifyPassword,
  validateNewPassword,
  isBcryptHash,
};
