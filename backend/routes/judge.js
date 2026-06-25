const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR, problemFromRow } = require('../db');
const { readCheckerSource } = require('../problem-files');

const router = express.Router();
const JUDGE_TOKEN = process.env.JUDGE_TOKEN || 'dev-judge-token';
function envNumber(name, fallback, min = 0) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(min, value) : fallback;
}
const JUDGE_LOCK_TIMEOUT_SECONDS = envNumber('JUDGE_LOCK_TIMEOUT_SECONDS', 600, 30);
if (process.env.NODE_ENV === 'production' && (!process.env.JUDGE_TOKEN || JUDGE_TOKEN === 'dev-judge-token' || JUDGE_TOKEN.length < 24)) {
  throw new Error('JUDGE_TOKEN must be set to a strong random value in production');
}

function requireJudge(req, res, next) {
  const token = req.headers['x-judge-token'];
  if (!token || token !== JUDGE_TOKEN) return res.status(401).json({ error: 'invalid judge token' });
  next();
}

function safeDataPath(relPath) {
  const resolved = path.resolve(DATA_DIR, relPath);
  const base = path.resolve(DATA_DIR);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error('invalid path');
  return resolved;
}

function reclaimStaleJudging() {
  return db.prepare(`UPDATE submissions
    SET status = 'Waiting', locked_at = NULL, judge_id = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE status = 'Judging'
      AND locked_at IS NOT NULL
      AND locked_at < datetime('now', ?)`).run(`-${JUDGE_LOCK_TIMEOUT_SECONDS} seconds`).changes;
}

router.post('/acquire', requireJudge, (req, res) => {
  const judgeId = String(req.body.judgeId || 'judge');
  const lock = db.transaction(() => {
    reclaimStaleJudging();
    const row = db.prepare("SELECT * FROM submissions WHERE status = 'Waiting' ORDER BY id ASC LIMIT 1").get();
    if (!row) return null;
    const info = db.prepare("UPDATE submissions SET status = 'Judging', locked_at = CURRENT_TIMESTAMP, judge_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'Waiting'")
      .run(judgeId, row.id);
    if (!info.changes) return null;
    return row.id;
  });

  const submissionId = lock();
  if (!submissionId) return res.json({ task: null });

  const s = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId);
  const p = problemFromRow(db.prepare('SELECT * FROM problems WHERE id = ?').get(s.problem_id));
  if (p.checkerMode === 'special_judge') p.checkerSource = readCheckerSource(p.id);
  const caseRows = db.prepare('SELECT * FROM problem_cases WHERE problem_id = ? ORDER BY sort, id').all(p.id);
  const cases = caseRows.map((c) => ({
    id: c.id,
    subtask: c.subtask || '',
    score: c.score,
    sort: c.sort,
    timeLimit: c.time_limit || p.timeLimit,
    memoryLimit: c.memory_limit || p.memoryLimit,
    inputPath: c.input_path,
    outputPath: c.output_path,
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

router.get('/cases/:caseId/:kind', requireJudge, (req, res) => {
  const caseId = Number(req.params.caseId);
  const kind = String(req.params.kind || '');
  if (!Number.isInteger(caseId) || caseId <= 0) return res.status(400).json({ error: 'invalid case id' });
  if (kind !== 'input' && kind !== 'output') return res.status(400).json({ error: 'invalid case file kind' });
  const row = db.prepare('SELECT input_path, output_path FROM problem_cases WHERE id = ?').get(caseId);
  if (!row) return res.status(404).json({ error: 'case not found' });
  const filePath = safeDataPath(kind === 'input' ? row.input_path : row.output_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'case file not found' });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(filePath);
});

router.post('/:id/result', requireJudge, (req, res) => {
  const id = Number(req.params.id);
  const result = req.body || {};
  const judgeId = String(result.judgeId || req.headers['x-judge-id'] || '');
  const status = String(result.status || 'System Error');
  const score = Number(result.score) || 0;
  const timeMs = Number(result.timeMs) || 0;
  const memoryKb = Number(result.memoryKb) || 0;
  const message = String(result.message || '');
  const details = Array.isArray(result.details) ? result.details : [];
  const info = db.prepare(`UPDATE submissions SET status = ?, score = ?, time_ms = ?, memory_kb = ?, message = ?,
    details_json = ?, locked_at = NULL, judge_id = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'Judging' AND (judge_id IS NULL OR judge_id = ?)`)
    .run(status, score, timeMs, memoryKb, message, JSON.stringify(details), id, judgeId);
  if (!info.changes) return res.status(409).json({ ok: false, error: 'stale judge result ignored' });
  res.json({ ok: true, changed: info.changes });
});

module.exports = router;
