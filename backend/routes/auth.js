const express = require('express');
const { db } = require('../db');
const { signUser, setAuthCookie, clearAuthCookie, requireLogin } = require('../auth');
const { hashPassword, verifyPassword } = require('../passwords');

const router = express.Router();

function publicUser(row) {
  if (!row) return null;
  return { id: row.id, username: row.username, role: row.role, createdAt: row.created_at };
}

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const row = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(row) });
});

router.post('/register', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
    return res.status(400).json({ error: '用户名只能包含字母、数字、下划线，长度 3-24' });
  }
  if (password.length < 6) return res.status(400).json({ error: '密码长度至少 6 位' });

  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const role = count === 0 ? 'admin' : 'user';
  const passwordHash = hashPassword(password);

  try {
    const info = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(username, passwordHash, role);
    const user = { id: info.lastInsertRowid, username, role };
    const token = signUser(user);
    setAuthCookie(req, res, token);
    res.json({ user });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: '用户名已存在' });
    throw err;
  }
});

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const verified = row ? verifyPassword(password, row.password_hash) : { ok: false };
  if (!row || !verified.ok) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  if (verified.shouldUpgrade) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.id);
  }
  const user = publicUser(row);
  const token = signUser(user);
  setAuthCookie(req, res, token);
  res.json({ user });
});

router.post('/logout', requireLogin, (req, res) => {
  clearAuthCookie(req, res);
  res.json({ ok: true });
});

module.exports = router;
