const express = require('express');
const AdmZip = require('adm-zip');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR, problemFromRow, caseFromRow } = require('../db');
const { requireLogin, requireAdmin } = require('../auth');
const {
  normalizeDifficulty,
  parseProblemCode,
  requireProblemCode,
  compareNatural,
  sortProblems,
} = require('../problem-utils');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.TESTDATA_ZIP_LIMIT || 50) * 1024 * 1024 } });
const attachmentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.ATTACHMENT_IMAGE_LIMIT || 5) * 1024 * 1024 } });
const SCORING_MODES = new Set(['oi', 'acm']);
const CHECKER_MODES = new Set(['standard', 'ignore_space', 'case_insensitive', 'float']);

function boolToInt(v) { return v ? 1 : 0; }
function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'on', 'yes'].includes(String(value).toLowerCase());
}
function getParamId(req) { return requireProblemCode(req.params.id); }

function nextProblemId() {
  const rows = db.prepare('SELECT id FROM problems').all();
  let max = 1000;
  for (const row of rows) {
    const parsed = String(row.id || '').match(/^P(\d+)$/);
    if (parsed) max = Math.max(max, Number(parsed[1]));
  }
  return `P${max + 1}`;
}

function sanitizeDataFileName(filename) {
  const raw = String(filename || '').replace(/\\/g, '/').split('/').filter(Boolean).join('_');
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || `file_${Date.now()}`;
}
function sanitizeSubtaskName(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim().replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_'))
    .filter(Boolean)
    .join('/')
    .slice(0, 80);
}
function normalizeScoringMode(value, fallback = 'oi') {
  const mode = String(value || fallback).trim();
  return SCORING_MODES.has(mode) ? mode : fallback;
}
function normalizeCheckerMode(value, fallback = 'standard') {
  const mode = String(value || fallback).trim();
  return CHECKER_MODES.has(mode) ? mode : fallback;
}
function normalizeCheckerTolerance(value, fallback = 0.000001) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 1);
}
function ensureProblemDir(problemId) {
  const dir = path.join(DATA_DIR, 'problems', `${problemId}`, 'testdata');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function problemRoot(problemId) { return path.join(DATA_DIR, 'problems', `${problemId}`); }
function attachmentDir(problemId) {
  const dir = path.join(problemRoot(problemId), 'attachments');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function sanitizeAttachmentFileName(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  const base = path.basename(String(filename || 'image'), ext).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '') || 'image';
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${base}${ext}`;
}
function copyAttachmentsAndRewriteDescription(fromId, toId, description) {
  const fromDir = path.join(problemRoot(fromId), 'attachments');
  const toDir = attachmentDir(toId);
  if (fs.existsSync(fromDir)) {
    for (const name of fs.readdirSync(fromDir)) {
      const src = path.join(fromDir, name);
      const dest = path.join(toDir, name);
      if (fs.statSync(src).isFile()) fs.copyFileSync(src, dest);
    }
  }
  const fromPrefix = `/api/problems/${encodeURIComponent(fromId)}/attachments/`;
  const toPrefix = `/api/problems/${encodeURIComponent(toId)}/attachments/`;
  return String(description || '').split(fromPrefix).join(toPrefix);
}
function caseRelativePath(problemId, file) { return path.join('problems', `${problemId}`, 'testdata', file).replace(/\\/g, '/'); }
function absoluteDataPath(relativePath) {
  const full = path.resolve(DATA_DIR, relativePath);
  const base = path.resolve(DATA_DIR);
  if (full !== base && !full.startsWith(base + path.sep)) throw Object.assign(new Error('非法文件路径'), { status: 400 });
  return full;
}
function readCaseContent(row) {
  const c = caseFromRow(row);
  c.input = fs.existsSync(absoluteDataPath(row.input_path)) ? fs.readFileSync(absoluteDataPath(row.input_path), 'utf8') : '';
  c.output = fs.existsSync(absoluteDataPath(row.output_path)) ? fs.readFileSync(absoluteDataPath(row.output_path), 'utf8') : '';
  return c;
}
function clearProblemCases(problemId) {
  db.prepare('DELETE FROM problem_cases WHERE problem_id = ?').run(problemId);
  const dir = ensureProblemDir(problemId);
  for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { force: true, recursive: true });
}

function validateProblemBody(body, existing = null) {
  const title = String(body.title ?? existing?.title ?? '').trim();
  if (!title) throw Object.assign(new Error('题目标题不能为空'), { status: 400 });
  const description = String(body.description ?? existing?.description ?? '').trim();
  if (!description) throw Object.assign(new Error('题面不能为空'), { status: 400 });
  const tags = Array.isArray(body.tags)
    ? body.tags.map((x) => String(x).trim()).filter(Boolean)
    : (existing ? JSON.parse(existing.tags_json || '[]') : []);
  const timeLimit = Math.max(100, Number(body.timeLimit ?? existing?.time_limit ?? 1000) || 1000);
  const memoryLimit = Math.max(16, Number(body.memoryLimit ?? existing?.memory_limit ?? 128) || 128);
  const difficulty = normalizeDifficulty(body.difficulty ?? existing?.difficulty ?? 'unrated');
  const scoringMode = normalizeScoringMode(body.scoringMode ?? existing?.scoring_mode ?? 'oi');
  const checkerMode = normalizeCheckerMode(body.checkerMode ?? existing?.checker_mode ?? 'standard');
  const checkerTolerance = normalizeCheckerTolerance(body.checkerTolerance ?? existing?.checker_tolerance ?? 0.000001);
  return {
    title,
    description,
    tags,
    difficulty,
    timeLimit,
    memoryLimit,
    scoringMode,
    checkerMode,
    checkerTolerance,
    isPublic: body.isPublic === undefined ? Boolean(existing?.is_public ?? true) : parseBoolean(body.isPublic, true),
  };
}

function selectProblemList(req, adminMode = false) {
  const params = [];
  const where = [];
  if (!adminMode) where.push('p.is_public = 1');
  if (req.query.status === 'public') where.push('p.is_public = 1');
  if (req.query.status === 'hidden' && adminMode) where.push('p.is_public = 0');
  if (req.query.keyword) {
    const kw = `%${String(req.query.keyword).trim()}%`;
    params.push(kw, kw, kw);
    where.push('(p.id LIKE ? OR p.title LIKE ? OR p.description LIKE ?)');
  }
  if (req.query.tag) {
    params.push(`%"${String(req.query.tag).trim()}"%`);
    where.push('p.tags_json LIKE ?');
  }
  if (req.query.difficulty) {
    params.push(normalizeDifficulty(req.query.difficulty));
    where.push('p.difficulty = ?');
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT p.*, COUNT(DISTINCT s.id) AS submit_count,
      COUNT(DISTINCT CASE WHEN s.status = 'Accepted' THEN s.id END) AS ac_count,
      COUNT(DISTINCT c.id) AS case_count
      FROM problems p
      LEFT JOIN submissions s ON s.problem_id = p.id
      LEFT JOIN problem_cases c ON c.problem_id = p.id
      ${whereSql}
      GROUP BY p.id`).all(...params);
  const acceptedSet = req.user
    ? new Set(db.prepare("SELECT DISTINCT problem_id FROM submissions WHERE user_id = ? AND status = 'Accepted'").all(req.user.id).map((r) => r.problem_id))
    : new Set();
  const list = rows.map((row) => ({
    ...problemFromRow(row),
    submitCount: row.submit_count || 0,
    acCount: row.ac_count || 0,
    caseCount: row.case_count || 0,
    accepted: acceptedSet.has(row.id),
  }));
  return sortProblems(list, String(req.query.sort || 'default'));
}

function sendRouteError(res, err, next) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  return next(err);
}

router.get('/', (req, res) => {
  const adminMode = req.user?.role === 'admin' && (req.query.all === '1' || req.query.manage === '1');
  res.json({ problems: selectProblemList(req, adminMode) });
});

router.get('/next-id', requireAdmin, (_req, res) => res.json({ id: nextProblemId() }));

router.get('/facets', (req, res) => {
  const includeHidden = req.user?.role === 'admin' && req.query.all === '1';
  const rows = includeHidden ? db.prepare('SELECT tags_json FROM problems').all() : db.prepare('SELECT tags_json FROM problems WHERE is_public = 1').all();
  const tags = new Set();
  for (const row of rows) {
    try { for (const tag of JSON.parse(row.tags_json || '[]')) if (tag) tags.add(tag); } catch (_) {}
  }
  res.json({ tags: [...tags].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')) });
});

router.post('/', requireAdmin, (req, res, next) => {
  try {
    const body = req.body || {};
    const rawId = String(body.id ?? '').trim();
    let id = parseProblemCode(rawId, { allowEmpty: true });
    if (rawId && !id) return res.status(400).json({ error: '题号格式错误：题号必须由若干大写英文字母 + 若干数字组成，例如 P1001、ABC12' });
    if (!id) id = nextProblemId();
    const data = validateProblemBody(body);
    db.prepare(`INSERT INTO problems
      (id, title, description, tags_json, difficulty, time_limit, memory_limit, scoring_mode, checker_mode, checker_tolerance, is_public, created_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(
      id,
      data.title,
      data.description,
      JSON.stringify(data.tags),
      data.difficulty,
      data.timeLimit,
      data.memoryLimit,
      data.scoringMode,
      data.checkerMode,
      data.checkerTolerance,
      boolToInt(data.isPublic),
      req.user.id,
    );
    ensureProblemDir(id);
    res.json({ problem: problemFromRow(db.prepare('SELECT * FROM problems WHERE id = ?').get(id)) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: '题号已存在' });
    return sendRouteError(res, err, next);
  }
});

router.post('/batch', requireAdmin, (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map((x) => parseProblemCode(x)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: '请选择题目' });
    const action = String(req.body.action || '');
    const placeholders = ids.map(() => '?').join(',');
    if (['publish', 'public', 'show'].includes(action) || ['hide', 'hidden'].includes(action)) {
      const visible = ['publish', 'public', 'show'].includes(action) ? 1 : 0;
      const info = db.prepare(`UPDATE problems SET is_public = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(visible, ...ids);
      return res.json({ ok: true, changed: info.changes });
    }
    if (action === 'delete') {
      const info = db.prepare(`DELETE FROM problems WHERE id IN (${placeholders})`).run(...ids);
      for (const id of ids) fs.rmSync(problemRoot(id), { recursive: true, force: true });
      return res.json({ ok: true, changed: info.changes });
    }
    return res.status(400).json({ error: '未知批量操作' });
  } catch (err) { return sendRouteError(res, err, next); }
});

router.get('/:id', (req, res, next) => {
  try {
    const id = getParamId(req);
    const row = db.prepare('SELECT * FROM problems WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: '题目不存在' });
    if (!row.is_public && req.user?.role !== 'admin') return res.status(403).json({ error: '题目未公开' });
    const problem = problemFromRow(row);
    const cases = req.user?.role === 'admin'
      ? db.prepare('SELECT id, subtask, score, sort, input_path AS inputPath, output_path AS outputPath FROM problem_cases WHERE problem_id = ? ORDER BY sort, id').all(id)
      : [];
    return res.json({ problem, cases });
  } catch (err) { return sendRouteError(res, err, next); }
});

router.put('/:id', requireAdmin, (req, res, next) => {
  try {
    const id = getParamId(req);
    const existing = db.prepare('SELECT * FROM problems WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: '题目不存在' });
    const data = validateProblemBody(req.body || {}, existing);
    db.prepare(`UPDATE problems SET
      title = ?, description = ?, tags_json = ?, difficulty = ?, time_limit = ?, memory_limit = ?,
      scoring_mode = ?, checker_mode = ?, checker_tolerance = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).run(
      data.title,
      data.description,
      JSON.stringify(data.tags),
      data.difficulty,
      data.timeLimit,
      data.memoryLimit,
      data.scoringMode,
      data.checkerMode,
      data.checkerTolerance,
      boolToInt(data.isPublic),
      id,
    );
    res.json({ problem: problemFromRow(db.prepare('SELECT * FROM problems WHERE id = ?').get(id)) });
  } catch (err) { return sendRouteError(res, err, next); }
});

function updateProblemStatus(req, res, next) {
  try {
    const id = getParamId(req);
    const row = db.prepare('SELECT id FROM problems WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: '题目不存在' });
    const isPublic = parseBoolean(req.body.isPublic, false);
    db.prepare('UPDATE problems SET is_public = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(boolToInt(isPublic), id);
    res.json({ ok: true, problem: problemFromRow(db.prepare('SELECT * FROM problems WHERE id = ?').get(id)) });
  } catch (err) { return sendRouteError(res, err, next); }
}
router.patch('/:id/status', requireAdmin, updateProblemStatus);
router.post('/:id/status', requireAdmin, updateProblemStatus);

router.post('/:id/clone', requireAdmin, (req, res, next) => {
  try {
    const fromId = getParamId(req);
    const row = db.prepare('SELECT * FROM problems WHERE id = ?').get(fromId);
    if (!row) return res.status(404).json({ error: '题目不存在' });
    const rawToId = String(req.body.id ?? '').trim();
    let toId = parseProblemCode(rawToId, { allowEmpty: true });
    if (rawToId && !toId) return res.status(400).json({ error: '新题号格式错误：题号必须由若干大写英文字母 + 若干数字组成，例如 P1001、ABC12' });
    if (!toId) toId = nextProblemId();
    if (db.prepare('SELECT id FROM problems WHERE id = ?').get(toId)) return res.status(409).json({ error: '新题号已存在' });
    const cloneTitle = String(req.body.title || '').trim() || `${row.title} 副本`;
    const isPublic = parseBoolean(req.body.isPublic, false);
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO problems
        (id, title, description, tags_json, difficulty, time_limit, memory_limit, scoring_mode, checker_mode, checker_tolerance, is_public, created_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(
        toId,
        cloneTitle,
        copyAttachmentsAndRewriteDescription(fromId, toId, row.description || ''),
        row.tags_json || '[]',
        normalizeDifficulty(row.difficulty),
        row.time_limit,
        row.memory_limit,
        normalizeScoringMode(row.scoring_mode),
        normalizeCheckerMode(row.checker_mode),
        normalizeCheckerTolerance(row.checker_tolerance),
        boolToInt(isPublic),
        req.user.id,
      );
      const cases = db.prepare('SELECT * FROM problem_cases WHERE problem_id = ? ORDER BY sort, id').all(fromId);
      const dir = ensureProblemDir(toId);
      for (const [idx, c] of cases.entries()) {
        const inputFile = `${c.sort}_${idx + 1}.in`;
        const outputFile = `${c.sort}_${idx + 1}.out`;
        const inputPath = absoluteDataPath(c.input_path);
        const outputPath = absoluteDataPath(c.output_path);
        fs.writeFileSync(path.join(dir, inputFile), fs.existsSync(inputPath) ? fs.readFileSync(inputPath) : Buffer.from(''));
        fs.writeFileSync(path.join(dir, outputFile), fs.existsSync(outputPath) ? fs.readFileSync(outputPath) : Buffer.from(''));
        db.prepare('INSERT INTO problem_cases (problem_id, input_path, output_path, subtask, score, sort) VALUES (?, ?, ?, ?, ?, ?)')
          .run(toId, caseRelativePath(toId, inputFile), caseRelativePath(toId, outputFile), c.subtask || '', c.score, c.sort);
      }
    });
    tx();
    res.json({ problem: problemFromRow(db.prepare('SELECT * FROM problems WHERE id = ?').get(toId)) });
  } catch (err) { return sendRouteError(res, err, next); }
});

router.delete('/:id', requireAdmin, (req, res, next) => {
  try {
    const id = getParamId(req);
    const row = db.prepare('SELECT id FROM problems WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: '题目不存在' });
    const info = db.prepare('DELETE FROM problems WHERE id = ?').run(id);
    fs.rmSync(problemRoot(id), { recursive: true, force: true });
    res.json({ ok: true, changed: info.changes });
  } catch (err) { return sendRouteError(res, err, next); }
});


router.post('/:id/attachments', requireAdmin, attachmentUpload.single('file'), (req, res, next) => {
  try {
    const problemId = getParamId(req);
    if (!req.file) return res.status(400).json({ error: '请上传图片文件' });
    const mime = String(req.file.mimetype || '').toLowerCase();
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const allowedExt = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
    if (!mime.startsWith('image/') || !allowedExt.has(ext)) {
      return res.status(400).json({ error: '仅支持 png、jpg、jpeg、gif、webp 图片' });
    }
    const filename = sanitizeAttachmentFileName(req.file.originalname || `image${ext || '.png'}`);
    fs.writeFileSync(path.join(attachmentDir(problemId), filename), req.file.buffer);
    res.json({ ok: true, filename, url: `/api/problems/${encodeURIComponent(problemId)}/attachments/${encodeURIComponent(filename)}` });
  } catch (err) { return sendRouteError(res, err, next); }
});

router.get('/:id/attachments/:filename', (req, res, next) => {
  try {
    const problemId = getParamId(req);
    const row = db.prepare('SELECT is_public FROM problems WHERE id = ?').get(problemId);
    if (!row) return res.status(404).json({ error: '题目不存在' });
    if (row && !row.is_public && req.user?.role !== 'admin') return res.status(403).json({ error: '题目未公开' });
    const filename = path.basename(String(req.params.filename || ''));
    if (!filename) return res.status(404).end();
    const filePath = path.resolve(attachmentDir(problemId), filename);
    const dir = path.resolve(attachmentDir(problemId));
    if (!filePath.startsWith(dir + path.sep)) return res.status(400).json({ error: '非法文件路径' });
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
  } catch (err) { return sendRouteError(res, err, next); }
});

router.get('/:id/cases', requireAdmin, (req, res, next) => {
  try {
    const id = getParamId(req);
    const problem = db.prepare('SELECT id FROM problems WHERE id = ?').get(id);
    if (!problem) return res.status(404).json({ error: '题目不存在' });
    const rows = db.prepare('SELECT * FROM problem_cases WHERE problem_id = ? ORDER BY sort, id').all(id);
    const cases = req.query.content === '1' ? rows.map(readCaseContent) : rows.map(caseFromRow);
    res.json({ cases });
  } catch (err) { return sendRouteError(res, err, next); }
});

router.post('/:id/cases/zip', requireAdmin, upload.single('file'), (req, res, next) => {
  try {
    const problemId = getParamId(req);
    const problem = db.prepare('SELECT * FROM problems WHERE id = ?').get(problemId);
    if (!problem) return res.status(404).json({ error: '题目不存在' });
    if (!req.file) return res.status(400).json({ error: '请上传 zip 文件' });
    const replace = parseBoolean(req.body.replace, true);
    const autoScore = parseBoolean(req.body.autoScore, true);
    const zip = new AdmZip(req.file.buffer);
    const files = new Map();
    const ignored = [];
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const rawName = String(entry.entryName || '').replace(/\\/g, '/');
      if (!rawName || rawName.includes('__MACOSX') || rawName.startsWith('.')) continue;
      const ext = path.extname(rawName).toLowerCase();
      if (!['.in', '.out', '.ans'].includes(ext)) { ignored.push(rawName); continue; }
      const stem = rawName.slice(0, -ext.length).replace(/\\/g, '/');
      const parts = stem.split('/').filter(Boolean);
      const key = parts.join('/');
      if (!files.has(key)) files.set(key, {});
      const item = files.get(key);
      if (ext === '.in') item.input = entry.getData();
      if (ext === '.out' || ext === '.ans') item.output = entry.getData();
      item.rawStem = key;
      item.subtask = sanitizeSubtaskName(parts.length > 1 ? parts.slice(0, -1).join('/') : '');
    }
    const pairs = [...files.values()].filter((item) => item.input && item.output).sort((a, b) => compareNatural(a.rawStem, b.rawStem));
    const missing = [...files.values()].filter((item) => !item.input || !item.output).map((item) => item.rawStem);
    if (!pairs.length) return res.status(400).json({ error: 'zip 中没有识别到成对的 .in/.out 或 .in/.ans 测试数据' });

    const dir = ensureProblemDir(problemId);
    const startSort = replace ? 1 : (db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM problem_cases WHERE problem_id = ?').get(problemId).s || 1);
    const baseScore = autoScore ? Math.floor(100 / pairs.length) : 0;
    const remainder = autoScore ? 100 - baseScore * pairs.length : 0;
    const tx = db.transaction(() => {
      if (replace) clearProblemCases(problemId);
      pairs.forEach((item, idx) => {
        const sort = startSort + idx;
        const safeStem = sanitizeDataFileName(item.rawStem || String(sort)).replace(/\.(in|out|ans)$/i, '') || String(sort);
        const inputFile = `${sort}_${safeStem}.in`;
        const outputFile = `${sort}_${safeStem}.out`;
        fs.writeFileSync(path.join(dir, inputFile), item.input);
        fs.writeFileSync(path.join(dir, outputFile), item.output);
        const score = autoScore ? baseScore + (idx === pairs.length - 1 ? remainder : 0) : 0;
        db.prepare('INSERT INTO problem_cases (problem_id, input_path, output_path, subtask, score, sort) VALUES (?, ?, ?, ?, ?, ?)')
          .run(problemId, caseRelativePath(problemId, inputFile), caseRelativePath(problemId, outputFile), item.subtask || '', score, sort);
      });
    });
    tx();
    return res.json({ ok: true, imported: pairs.length, ignored, missing, replace, autoScore });
  } catch (err) { return sendRouteError(res, err, next); }
});

router.post('/:id/cases', requireAdmin, (req, res, next) => {
  try {
    const problemId = getParamId(req);
    const problem = db.prepare('SELECT * FROM problems WHERE id = ?').get(problemId);
    if (!problem) return res.status(404).json({ error: '题目不存在' });
    const input = String(req.body.input ?? '');
    const output = String(req.body.output ?? '');
    const subtask = sanitizeSubtaskName(req.body.subtask);
    const score = Number(req.body.score) || 0;
    const nextSort = Number(req.body.sort) || (db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM problem_cases WHERE problem_id = ?').get(problemId).s || 1);
    const dir = ensureProblemDir(problemId);
    const inputFile = `${nextSort}.in`;
    const outputFile = `${nextSort}.out`;
    fs.writeFileSync(path.join(dir, inputFile), input);
    fs.writeFileSync(path.join(dir, outputFile), output);
    const info = db.prepare('INSERT INTO problem_cases (problem_id, input_path, output_path, subtask, score, sort) VALUES (?, ?, ?, ?, ?, ?)')
      .run(problemId, caseRelativePath(problemId, inputFile), caseRelativePath(problemId, outputFile), subtask, score, nextSort);
    res.json({ case: { id: info.lastInsertRowid, problemId, subtask, score, sort: nextSort } });
  } catch (err) { return sendRouteError(res, err, next); }
});

router.put('/:id/cases/:caseId', requireAdmin, (req, res, next) => {
  try {
    const problemId = getParamId(req);
    const caseId = Number(req.params.caseId);
    const row = db.prepare('SELECT * FROM problem_cases WHERE id = ? AND problem_id = ?').get(caseId, problemId);
    if (!row) return res.status(404).json({ error: '测试点不存在' });
    const score = Number(req.body.score ?? row.score) || 0;
    const sort = Number(req.body.sort ?? row.sort) || row.sort;
    const subtask = req.body.subtask === undefined ? (row.subtask || '') : sanitizeSubtaskName(req.body.subtask);
    if (req.body.input !== undefined) fs.writeFileSync(absoluteDataPath(row.input_path), String(req.body.input));
    if (req.body.output !== undefined) fs.writeFileSync(absoluteDataPath(row.output_path), String(req.body.output));
    db.prepare('UPDATE problem_cases SET subtask = ?, score = ?, sort = ? WHERE id = ?').run(subtask, score, sort, caseId);
    res.json({ case: readCaseContent(db.prepare('SELECT * FROM problem_cases WHERE id = ?').get(caseId)) });
  } catch (err) { return sendRouteError(res, err, next); }
});

router.delete('/:id/cases/:caseId', requireAdmin, (req, res, next) => {
  try {
    const problemId = getParamId(req);
    const caseId = Number(req.params.caseId);
    const row = db.prepare('SELECT * FROM problem_cases WHERE id = ? AND problem_id = ?').get(caseId, problemId);
    if (!row) return res.status(404).json({ error: '测试点不存在' });
    db.prepare('DELETE FROM problem_cases WHERE id = ?').run(caseId);
    fs.rmSync(absoluteDataPath(row.input_path), { force: true });
    fs.rmSync(absoluteDataPath(row.output_path), { force: true });
    res.json({ ok: true });
  } catch (err) { return sendRouteError(res, err, next); }
});

router.post('/:id/rejudge', requireAdmin, (req, res, next) => {
  try {
    const problemId = getParamId(req);
    const info = db.prepare(`UPDATE submissions SET status = 'Waiting', score = 0, time_ms = 0, memory_kb = 0,
      message = '', details_json = '[]', locked_at = NULL, judge_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE problem_id = ?`).run(problemId);
    res.json({ ok: true, changed: info.changes });
  } catch (err) { return sendRouteError(res, err, next); }
});

router.post('/:id/submit', requireLogin, (req, res, next) => {
  try {
    const problemId = getParamId(req);
    const problem = db.prepare('SELECT * FROM problems WHERE id = ?').get(problemId);
    if (!problem) return res.status(404).json({ error: '题目不存在' });
    if (!problem.is_public && req.user.role !== 'admin') return res.status(403).json({ error: '题目未公开' });
    const language = String(req.body.language || '').trim();
    const code = String(req.body.code || '');
    const optimize = req.body.o2 === undefined ? true : parseBoolean(req.body.o2, true);
    if (!['cpp11', 'cpp14', 'cpp17', 'c', 'python'].includes(language)) return res.status(400).json({ error: '不支持的语言' });
    if (!code.trim()) return res.status(400).json({ error: '代码不能为空' });
    const info = db.prepare(`INSERT INTO submissions (user_id, problem_id, language, code, optimize, status)
      VALUES (?, ?, ?, ?, ?, 'Waiting')`).run(req.user.id, problemId, language, code, boolToInt(optimize));
    res.json({ submissionId: info.lastInsertRowid });
  } catch (err) { return sendRouteError(res, err, next); }
});

module.exports = router;
