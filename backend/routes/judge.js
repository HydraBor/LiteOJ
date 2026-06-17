const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR, problemFromRow } = require('../db');

const router = express.Router();
const JUDGE_TOKEN = process.env.JUDGE_TOKEN || 'dev-judge-token';

function requireJudge(req, res, next) {
  const token = req.headers['x-judge-token'];
  if (!token || token !== JUDGE_TOKEN) return res.status(401).json({ error: 'invalid judge token' });
  next();
}

function readDataFile(relPath) {
  const resolved = path.resolve(DATA_DIR, relPath);
  const base = path.resolve(DATA_DIR);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error('invalid path');
  return fs.readFileSync(resolved, 'utf8');
}

router.post('/acquire', requireJudge, (req, res) => {
  const judgeId = String(req.body.judgeId || 'judge');
  const lock = db.transaction(() => {
    const row = db.prepare("SELECT * FROM submissions WHERE status = 'Waiting' ORDER BY id ASC LIMIT 1").get();
    if (!row) return null;
    db.prepare("UPDATE submissions SET status = 'Judging', locked_at = CURRENT_TIMESTAMP, judge_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(judgeId, row.id);
    return row.id;
  });

  const submissionId = lock();
  if (!submissionId) return res.json({ task: null });

  const s = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId);
  const p = problemFromRow(db.prepare('SELECT * FROM problems WHERE id = ?').get(s.problem_id));
  const caseRows = db.prepare('SELECT * FROM problem_cases WHERE problem_id = ? ORDER BY sort, id').all(p.id);
  const cases = caseRows.map((c) => ({
    id: c.id,
    subtask: c.subtask || '',
    score: c.score,
    sort: c.sort,
    input: readDataFile(c.input_path),
    output: readDataFile(c.output_path),
  }));

  res.json({
    task: {
      id: s.id,
      problem: p,
      submission: {
        id: s.id,
        language: s.language,
        optimize: Boolean(s.optimize),
        code: s.code,
      },
      cases,
    },
  });
});

router.post('/:id/result', requireJudge, (req, res) => {
  const id = Number(req.params.id);
  const result = req.body || {};
  const status = String(result.status || 'System Error');
  const score = Number(result.score) || 0;
  const timeMs = Number(result.timeMs) || 0;
  const memoryKb = Number(result.memoryKb) || 0;
  const message = String(result.message || '');
  const details = Array.isArray(result.details) ? result.details : [];
  const info = db.prepare(`UPDATE submissions SET status = ?, score = ?, time_ms = ?, memory_kb = ?, message = ?,
    details_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(status, score, timeMs, memoryKb, message, JSON.stringify(details), id);
  res.json({ ok: true, changed: info.changes });
});

module.exports = router;
