const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();

router.get('/stats', requireAdmin, (_req, res) => {
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const problems = db.prepare('SELECT COUNT(*) AS c FROM problems').get().c;
  const publicProblems = db.prepare('SELECT COUNT(*) AS c FROM problems WHERE is_public = 1').get().c;
  const hiddenProblems = db.prepare('SELECT COUNT(*) AS c FROM problems WHERE is_public = 0').get().c;
  const cases = db.prepare('SELECT COUNT(*) AS c FROM problem_cases').get().c;
  const submissions = db.prepare('SELECT COUNT(*) AS c FROM submissions').get().c;
  const waiting = db.prepare("SELECT COUNT(*) AS c FROM submissions WHERE status IN ('Waiting', 'Judging')").get().c;
  const prelimPapers = db.prepare('SELECT COUNT(*) AS c FROM prelim_papers').get().c;
  const prelimQuestions = db.prepare('SELECT COUNT(*) AS c FROM prelim_questions').get().c;
  const byStatus = db.prepare('SELECT status, COUNT(*) AS count FROM submissions GROUP BY status ORDER BY count DESC').all();
  res.json({ users, problems, publicProblems, hiddenProblems, cases, submissions, waiting, byStatus, prelimPapers, prelimQuestions });
});

router.get('/users', requireAdmin, (_req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at AS createdAt FROM users ORDER BY id ASC').all();
  res.json({ users });
});

router.patch('/users/:id/role', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const role = String(req.body.role || 'user');
  if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: '角色只能是 user 或 admin' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  res.json({ ok: true });
});

module.exports = router;
