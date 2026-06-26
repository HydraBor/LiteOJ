const express = require('express');
const { db, submissionFromRow } = require('../db');
const { requireLogin } = require('../auth');

const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const requestedLimit = Number(req.query.limit);
  const requestedPage = Number(req.query.page);
  const limit = [10, 20, 50, 100].includes(requestedLimit) ? requestedLimit : 20;
  const rawPage = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const params = [];
  let where = '';
  if (!isAdmin) {
    where = 'WHERE s.user_id = ?';
    params.push(req.user.id);
  }
  if (req.query.problemId) {
    where += where ? ' AND s.problem_id = ?' : 'WHERE s.problem_id = ?';
    params.push(String(req.query.problemId));
  }
  const total = db.prepare(`SELECT COUNT(*) AS count FROM submissions s ${where}`).get(...params).count;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(rawPage, totalPages);
  const offset = (page - 1) * limit;
  const rows = db.prepare(`SELECT s.*, u.username, p.title AS problem_title
    FROM submissions s
    JOIN users u ON u.id = s.user_id
    JOIN problems p ON p.id = s.problem_id
    ${where}
    ORDER BY s.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  res.json({ total, page, pageSize: limit, submissions: rows.map((row) => {
    const s = submissionFromRow(row);
    if (!isAdmin && s.userId !== req.user.id) delete s.code;
    return s;
  }) });
});

router.get('/:id', requireLogin, (req, res) => {
  const row = db.prepare(`SELECT s.*, u.username, p.title AS problem_title
    FROM submissions s
    JOIN users u ON u.id = s.user_id
    JOIN problems p ON p.id = s.problem_id
    WHERE s.id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '提交记录不存在' });
  if (req.user.role !== 'admin' && row.user_id !== req.user.id) return res.status(403).json({ error: '无权查看该提交' });
  res.json({ submission: submissionFromRow(row) });
});

router.post('/:id/rejudge', requireLogin, (req, res) => {
  const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '提交记录不存在' });
  if (req.user.role !== 'admin' && row.user_id !== req.user.id) return res.status(403).json({ error: '无权重测该提交' });
  db.prepare(`UPDATE submissions SET status = 'Waiting', score = 0, time_ms = 0, memory_kb = 0,
    message = '', details_json = '[]', locked_at = NULL, judge_id = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`).run(row.id);
  res.json({ ok: true });
});

module.exports = router;
