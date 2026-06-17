const express = require('express');
const { db } = require('../db');
const { requireLogin } = require('../auth');
const { hashPassword, verifyPassword, validateNewPassword } = require('../passwords');

const router = express.Router();

router.use(requireLogin);

router.post('/password', (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  const confirmPassword = String(req.body.confirmPassword || '');

  if (!currentPassword) return res.status(400).json({ error: '请输入当前密码' });
  if (newPassword !== confirmPassword) return res.status(400).json({ error: '两次输入的新密码不一致' });
  const validationError = validateNewPassword(newPassword);
  if (validationError) return res.status(400).json({ error: validationError });
  if (currentPassword === newPassword) return res.status(400).json({ error: '新密码不能和当前密码相同' });

  const row = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(404).json({ error: '账号不存在' });

  const verified = verifyPassword(currentPassword, row.password_hash);
  if (!verified.ok) return res.status(401).json({ error: '当前密码错误' });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
