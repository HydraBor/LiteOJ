const { db, migrate } = require('../backend/db');
const { hashPassword, validateNewPassword } = require('../backend/passwords');

const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'admin123';

function usage() {
  console.error('Usage: node scripts/reset-admin.js [username] [password]');
  console.error('       ADMIN_USERNAME=admin ADMIN_PASSWORD=admin123 npm run reset-admin');
}

function main() {
  migrate();

  const username = String(process.argv[2] || process.env.ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME).trim();
  const password = String(process.argv[3] || process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD);

  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
    usage();
    throw new Error('Admin username must contain only letters, numbers, or underscores, length 3-24.');
  }
  const passwordError = validateNewPassword(password);
  if (passwordError) {
    usage();
    throw new Error(passwordError);
  }

  const reset = db.transaction(() => {
    const existingTarget = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username);
    if (existingTarget) {
      db.prepare("UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?")
        .run(hashPassword(password), existingTarget.id);
      return `Reset existing user as admin: ${username}`;
    }

    const existingAdmin = db.prepare("SELECT id, username FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
    if (existingAdmin) {
      db.prepare("UPDATE users SET username = ?, password_hash = ?, role = 'admin' WHERE id = ?")
        .run(username, hashPassword(password), existingAdmin.id);
      return `Renamed existing admin ${existingAdmin.username} to ${username} and reset password.`;
    }

    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')")
      .run(username, hashPassword(password));
    return `Created admin user: ${username}`;
  });

  console.log(reset());
}

main();
