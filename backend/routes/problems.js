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
const {
  boolToInt,
  parseBoolean,
  normalizeCheckerMode,
  normalizeCheckerTolerance,
} = require('../problem-config');
const { normalizeTagList, resolveTagQuery, syncProblemTags } = require('../tag-service');
const {
  sanitizeDataFileName,
  sanitizeSubtaskName,
  problemRoot,
  ensureProblemDir,
  attachmentDir,
  hasCheckerSource,
  readCheckerSource,
  writeCheckerSource,
  deleteCheckerSource,
  sanitizeAttachmentFileName,
  copyAttachmentsAndRewriteDescription,
  caseRelativePath,
  absoluteDataPath,
  readCaseContent,
} = require('../problem-files');

const router = express.Router();
const TESTDATA_ZIP_LIMIT_BYTES = Number(process.env.TESTDATA_ZIP_LIMIT || 50) * 1024 * 1024;
const ATTACHMENT_FILE_LIMIT_BYTES = Number(process.env.ATTACHMENT_FILE_LIMIT || 200) * 1024 * 1024;
const CHECKER_SOURCE_LIMIT_BYTES = Number(process.env.CHECKER_SOURCE_LIMIT || 1) * 1024 * 1024;
const ATTACHMENT_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.xz',
  '.pdf', '.txt', '.md', '.in', '.out', '.ans',
  '.doc', '.docx', '.xls', '.xlsx',
]);
const IMAGE_ATTACHMENT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
function attachmentTempDir() {
  const dir = path.join(DATA_DIR, '.tmp', 'attachments');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function tempAttachmentFileName(file) {
  const safe = sanitizeAttachmentFileName(file?.originalname || 'attachment');
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
}
function contentDispositionAttachment(filename) {
  const safe = sanitizeAttachmentFileName(filename);
  const fallback = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'attachment';
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: TESTDATA_ZIP_LIMIT_BYTES } });
const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, attachmentTempDir()),
    filename: (_req, file, cb) => cb(null, tempAttachmentFileName(file)),
  }),
  limits: { fileSize: ATTACHMENT_FILE_LIMIT_BYTES },
});
const checkerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.CHECKER_SOURCE_LIMIT || 1) * 1024 * 1024 } });
const TESTDATA_UNZIPPED_LIMIT_BYTES = Number(process.env.TESTDATA_UNZIPPED_LIMIT || 200) * 1024 * 1024;

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

function clearProblemCases(problemId) {
  db.prepare('DELETE FROM problem_cases WHERE problem_id = ?').run(problemId);
  const dir = ensureProblemDir(problemId);
  for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { force: true, recursive: true });
}

function caseScore(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function caseTimeLimit(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.max(100, Math.round(n)) : 0;
}

function caseMemoryLimit(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.max(16, Math.round(n)) : 0;
}

function subtaskScore(problemId, subtask) {
  const name = sanitizeSubtaskName(subtask);
  if (!name) return 0;
  const row = db.prepare('SELECT COALESCE(SUM(score), 0) AS score FROM problem_cases WHERE problem_id = ? AND subtask = ?')
    .get(problemId, name);
  return caseScore(row?.score);
}

function rebalanceSubtaskScores(problemId, subtask, preferredCaseId = null, score = null) {
  const name = sanitizeSubtaskName(subtask);
  if (!name) return;
  const rows = db.prepare('SELECT id, score FROM problem_cases WHERE problem_id = ? AND subtask = ? ORDER BY sort, id').all(problemId, name);
  if (!rows.length) return;
  const groupScore = score === null ? rows.reduce((sum, row) => sum + caseScore(row.score), 0) : caseScore(score);
  const preferred = preferredCaseId && rows.some((row) => row.id === Number(preferredCaseId)) ? Number(preferredCaseId) : rows[0].id;
  const update = db.prepare('UPDATE problem_cases SET score = ? WHERE id = ?');
  for (const row of rows) update.run(row.id === preferred ? groupScore : 0, row.id);
}

function rebalanceAllSubtasks(problemId) {
  const rows = db.prepare("SELECT DISTINCT subtask FROM problem_cases WHERE problem_id = ? AND subtask <> ''").all(problemId);
  for (const row of rows) rebalanceSubtaskScores(problemId, row.subtask);
}

function caseWithSubtaskScore(problemId, row) {
  const item = readCaseContent(row);
  if (item.subtask) item.subtaskScore = subtaskScore(problemId, item.subtask);
  return item;
}

function validateProblemBody(body, existing = null) {
  const title = String(body.title ?? existing?.title ?? '').trim();
  if (!title) throw Object.assign(new Error('题目标题不能为空'), { status: 400 });
  const description = String(body.description ?? existing?.description ?? '').trim();
  if (!description) throw Object.assign(new Error('题面不能为空'), { status: 400 });
  const tags = normalizeTagList(
    Array.isArray(body.tags) ? body.tags : (existing ? JSON.parse(existing.tags_json || '[]') : []),
    { problemMode: true, throwOnUnknown: true },
  );
  const timeLimit = Math.max(100, Number(body.timeLimit ?? existing?.time_limit ?? 1000) || 1000);
  const memoryLimit = Math.max(16, Number(body.memoryLimit ?? existing?.memory_limit ?? 128) || 128);
  const difficulty = normalizeDifficulty(body.difficulty ?? existing?.difficulty ?? 'unrated');
  const checkerMode = normalizeCheckerMode(body.checkerMode ?? existing?.checker_mode ?? 'standard');
  const checkerTolerance = normalizeCheckerTolerance(body.checkerTolerance ?? existing?.checker_tolerance ?? 0.000001);
  return {
    title,
    description,
    tags,
    difficulty,
    timeLimit,
    memoryLimit,
    checkerMode,
    checkerTolerance,
    isPublic: body.isPublic === undefined ? Boolean(existing?.is_public ?? false) : parseBoolean(body.isPublic, false),
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
    const tagSlug = resolveTagQuery(db, req.query.tag);
    if (tagSlug) {
      params.push(tagSlug);
      where.push('EXISTS (SELECT 1 FROM oj_problem_tags pt WHERE pt.problem_id = p.id AND pt.tag_slug = ?)');
    }
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

function problemWithChecker(row) {
  const problem = problemFromRow(row);
  if (problem) problem.hasChecker = hasCheckerSource(problem.id);
  return problem;
}

function validateCheckerUpload(file) {
  if (!file) throw Object.assign(new Error('请上传 checker.cpp'), { status: 400 });
  const name = path.basename(String(file.originalname || '')).toLowerCase();
  if (name !== 'checker.cpp' && path.extname(name) !== '.cpp') {
    throw Object.assign(new Error('Special Judge 仅支持上传 checker.cpp / .cpp 源文件'), { status: 400 });
  }
  if (file.buffer.length > CHECKER_SOURCE_LIMIT_BYTES) {
    throw Object.assign(new Error(`checker.cpp 不能超过 ${Math.round(CHECKER_SOURCE_LIMIT_BYTES / 1024 / 1024)} MB`), { status: 413 });
  }
  const source = file.buffer.toString('utf8');
  if (!source.trim()) throw Object.assign(new Error('checker.cpp 不能为空'), { status: 400 });
  return source;
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
    try {
      for (const tag of JSON.parse(row.tags_json || '[]')) {
        const name = typeof tag === 'string' ? tag : tag?.nameZh || tag?.name;
        if (name) tags.add(name);
      }
    } catch (_) {}
  }
  const tagRows = db.prepare(`SELECT DISTINCT t.slug, t.name_zh
    FROM problems p
    JOIN oj_problem_tags pt ON pt.problem_id = p.id
    JOIN oj_tags t ON t.slug = pt.tag_slug
    ${includeHidden ? '' : 'WHERE p.is_public = 1'}
    ORDER BY t.sort_order ASC, t.name_zh ASC`).all();
  res.json({
    tags: tagRows.length
      ? tagRows.map((tag) => ({ value: tag.slug, label: tag.name_zh, slug: tag.slug, name: tag.name_zh }))
      : [...tags].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
  });
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
      (id, title, description, tags_json, difficulty, time_limit, memory_limit, checker_mode, checker_tolerance, is_public, created_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(
      id,
      data.title,
      data.description,
      JSON.stringify(data.tags),
      data.difficulty,
      data.timeLimit,
      data.memoryLimit,
      data.checkerMode,
      data.checkerTolerance,
      boolToInt(data.isPublic),
      req.user.id,
    );
    syncProblemTags(db, id, data.tags, 'manual');
    ensureProblemDir(id);
    res.json({ problem: problemWithChecker(db.prepare('SELECT * FROM problems WHERE id = ?').get(id)) });
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
    const problem = problemWithChecker(row);
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
      checker_mode = ?, checker_tolerance = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).run(
      data.title,
      data.description,
      JSON.stringify(data.tags),
      data.difficulty,
      data.timeLimit,
      data.memoryLimit,
      data.checkerMode,
      data.checkerTolerance,
      boolToInt(data.isPublic),
      id,
    );
    syncProblemTags(db, id, data.tags, 'manual');
    res.json({ problem: problemWithChecker(db.prepare('SELECT * FROM problems WHERE id = ?').get(id)) });
  } catch (err) { return sendRouteError(res, err, next); }
});

function updateProblemStatus(req, res, next) {
  try {
    const id = getParamId(req);
    const row = db.prepare('SELECT id FROM problems WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: '题目不存在' });
    const isPublic = parseBoolean(req.body.isPublic, false);
    db.prepare('UPDATE problems SET is_public = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(boolToInt(isPublic), id);
    res.json({ ok: true, problem: problemWithChecker(db.prepare('SELECT * FROM problems WHERE id = ?').get(id)) });
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
        (id, title, description, tags_json, difficulty, time_limit, memory_limit, checker_mode, checker_tolerance, is_public, created_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(
        toId,
        cloneTitle,
        copyAttachmentsAndRewriteDescription(fromId, toId, row.description || ''),
        row.tags_json || '[]',
        normalizeDifficulty(row.difficulty),
        row.time_limit,
        row.memory_limit,
        normalizeCheckerMode(row.checker_mode),
        normalizeCheckerTolerance(row.checker_tolerance),
        boolToInt(isPublic),
        req.user.id,
      );
      const cases = db.prepare('SELECT * FROM problem_cases WHERE problem_id = ? ORDER BY sort, id').all(fromId);
      const dir = ensureProblemDir(toId);
      if (hasCheckerSource(fromId)) writeCheckerSource(toId, readCheckerSource(fromId));
      for (const [idx, c] of cases.entries()) {
        const inputFile = `${c.sort}_${idx + 1}.in`;
        const outputFile = `${c.sort}_${idx + 1}.out`;
        const inputPath = absoluteDataPath(c.input_path);
        const outputPath = absoluteDataPath(c.output_path);
        fs.writeFileSync(path.join(dir, inputFile), fs.existsSync(inputPath) ? fs.readFileSync(inputPath) : Buffer.from(''));
        fs.writeFileSync(path.join(dir, outputFile), fs.existsSync(outputPath) ? fs.readFileSync(outputPath) : Buffer.from(''));
        db.prepare('INSERT INTO problem_cases (problem_id, input_path, output_path, subtask, score, sort, time_limit, memory_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(toId, caseRelativePath(toId, inputFile), caseRelativePath(toId, outputFile), c.subtask || '', c.score, c.sort, c.time_limit || 0, c.memory_limit || 0);
      }
      rebalanceAllSubtasks(toId);
    });
    tx();
    syncProblemTags(db, toId, JSON.parse(row.tags_json || '[]'), 'manual');
    res.json({ problem: problemWithChecker(db.prepare('SELECT * FROM problems WHERE id = ?').get(toId)) });
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
    if (!req.file) return res.status(400).json({ error: '请上传附件文件' });
    const filename = sanitizeAttachmentFileName(req.file.originalname || req.file.filename || 'attachment');
    const mime = String(req.file.mimetype || '').toLowerCase();
    const ext = path.extname(filename).toLowerCase();
    if (!ATTACHMENT_EXTENSIONS.has(ext)) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: '不支持的附件类型，请上传图片、zip/7z/rar/tar 压缩包、PDF、文本或 Office 文件' });
    }
    const target = path.join(attachmentDir(problemId), filename);
    try {
      fs.renameSync(req.file.path, target);
    } catch (moveErr) {
      fs.rmSync(req.file.path, { force: true });
      throw moveErr;
    }
    const isImage = mime.startsWith('image/') && IMAGE_ATTACHMENT_EXTENSIONS.has(ext);
    res.json({
      ok: true,
      filename,
      originalName: filename,
      mime,
      size: req.file.size,
      isImage,
      url: `/api/problems/${encodeURIComponent(problemId)}/attachments/${encodeURIComponent(filename)}`,
    });
  } catch (err) { return sendRouteError(res, err, next); }
});

router.get('/:id/attachments/:filename', (req, res, next) => {
  try {
    const problemId = getParamId(req);
    const row = db.prepare('SELECT is_public FROM problems WHERE id = ?').get(problemId);
    if (!row && req.user?.role !== 'admin') return res.status(404).json({ error: '题目不存在' });
    if (row && !row.is_public && req.user?.role !== 'admin') return res.status(403).json({ error: '题目未公开' });
    const filename = path.basename(String(req.params.filename || ''));
    if (!filename) return res.status(404).end();
    const filePath = path.resolve(attachmentDir(problemId), filename);
    const dir = path.resolve(attachmentDir(problemId));
    if (!filePath.startsWith(dir + path.sep)) return res.status(400).json({ error: '非法文件路径' });
    if (!fs.existsSync(filePath)) return res.status(404).end();
    if (!IMAGE_ATTACHMENT_EXTENSIONS.has(path.extname(filename).toLowerCase())) {
      res.setHeader('Content-Disposition', contentDispositionAttachment(filename));
    }
    res.sendFile(filePath);
  } catch (err) { return sendRouteError(res, err, next); }
});

router.get('/:id/checker', requireAdmin, (req, res, next) => {
  try {
    const problemId = getParamId(req);
    const row = db.prepare('SELECT checker_mode FROM problems WHERE id = ?').get(problemId);
    if (!row) return res.status(404).json({ error: '题目不存在' });
    res.json({ mode: normalizeCheckerMode(row.checker_mode), hasChecker: hasCheckerSource(problemId), filename: hasCheckerSource(problemId) ? 'checker.cpp' : '' });
  } catch (err) { return sendRouteError(res, err, next); }
});

router.post('/:id/checker', requireAdmin, checkerUpload.single('checker'), (req, res, next) => {
  try {
    const problemId = getParamId(req);
    const row = db.prepare('SELECT id FROM problems WHERE id = ?').get(problemId);
    if (!row) return res.status(404).json({ error: '题目不存在' });
    const source = validateCheckerUpload(req.file);
    writeCheckerSource(problemId, source);
    db.prepare("UPDATE problems SET checker_mode = 'special_judge', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(problemId);
    res.json({ ok: true, mode: 'special_judge', hasChecker: true, filename: 'checker.cpp' });
  } catch (err) { return sendRouteError(res, err, next); }
});

router.delete('/:id/checker', requireAdmin, (req, res, next) => {
  try {
    const problemId = getParamId(req);
    const row = db.prepare('SELECT id FROM problems WHERE id = ?').get(problemId);
    if (!row) return res.status(404).json({ error: '题目不存在' });
    deleteCheckerSource(problemId);
    db.prepare("UPDATE problems SET checker_mode = 'standard', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(problemId);
    res.json({ ok: true, mode: 'standard', hasChecker: false });
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

router.get('/:id/cases/:caseId', requireAdmin, (req, res, next) => {
  try {
    const problemId = getParamId(req);
    const caseId = Number(req.params.caseId);
    const row = db.prepare('SELECT * FROM problem_cases WHERE id = ? AND problem_id = ?').get(caseId, problemId);
    if (!row) return res.status(404).json({ error: '测试点不存在' });
    const item = req.query.content === '1' ? caseWithSubtaskScore(problemId, row) : caseFromRow(row);
    return res.json({ case: item });
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
    const subtaskMode = parseBoolean(req.body.subtaskMode, false);
    const zip = new AdmZip(req.file.buffer);
    const files = new Map();
    const ignored = [];
    let checkerSource = '';
    let totalUnzippedBytes = 0;
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const rawName = String(entry.entryName || '').replace(/\\/g, '/');
      if (!rawName || rawName.includes('__MACOSX') || rawName.startsWith('.')) continue;
      const filename = path.basename(rawName).toLowerCase();
      if (filename === 'checker.cpp') {
        totalUnzippedBytes += Number(entry.header?.size || 0);
        if (totalUnzippedBytes > TESTDATA_UNZIPPED_LIMIT_BYTES) {
          return res.status(413).json({ error: `测试数据解压后总大小不能超过 ${Math.round(TESTDATA_UNZIPPED_LIMIT_BYTES / 1024 / 1024)} MB` });
        }
        const data = entry.getData();
        if (data.length > CHECKER_SOURCE_LIMIT_BYTES) {
          return res.status(413).json({ error: `checker.cpp 不能超过 ${Math.round(CHECKER_SOURCE_LIMIT_BYTES / 1024 / 1024)} MB` });
        }
        checkerSource = data.toString('utf8');
        continue;
      }
      const ext = path.extname(rawName).toLowerCase();
      if (!['.in', '.out', '.ans'].includes(ext)) { ignored.push(rawName); continue; }
      totalUnzippedBytes += Number(entry.header?.size || 0);
      if (totalUnzippedBytes > TESTDATA_UNZIPPED_LIMIT_BYTES) {
        return res.status(413).json({ error: `测试数据解压后总大小不能超过 ${Math.round(TESTDATA_UNZIPPED_LIMIT_BYTES / 1024 / 1024)} MB` });
      }
      const stem = rawName.slice(0, -ext.length).replace(/\\/g, '/');
      const parts = stem.split('/').filter(Boolean);
      const key = parts.join('/');
      if (!files.has(key)) files.set(key, {});
      const item = files.get(key);
      if (ext === '.in') item.input = entry.getData();
      if (ext === '.out' || ext === '.ans') item.output = entry.getData();
      item.rawStem = key;
      item.subtask = sanitizeSubtaskName(subtaskMode ? '子任务1' : '');
    }
    const pairs = [...files.values()].filter((item) => item.input && item.output).sort((a, b) => compareNatural(a.rawStem, b.rawStem));
    const missing = [...files.values()].filter((item) => !item.input || !item.output).map((item) => item.rawStem);
    if (!pairs.length) return res.status(400).json({ error: 'zip 中没有识别到成对的 .in/.out 或 .in/.ans 测试数据' });

    const dir = ensureProblemDir(problemId);
    const startSort = replace ? 1 : (db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM problem_cases WHERE problem_id = ?').get(problemId).s || 1);
    const scoreUnits = [];
    const seenSubtasks = new Set();
    pairs.forEach((item, idx) => {
      if (item.subtask) {
        if (!seenSubtasks.has(item.subtask)) {
          seenSubtasks.add(item.subtask);
          scoreUnits.push({ type: 'subtask', key: item.subtask });
        }
      } else {
        scoreUnits.push({ type: 'case', key: String(idx) });
      }
    });
    const baseScore = autoScore ? Math.floor(100 / scoreUnits.length) : 0;
    const remainder = autoScore ? 100 - baseScore * scoreUnits.length : 0;
    const unitScores = new Map(scoreUnits.map((unit, idx) => [`${unit.type}:${unit.key}`, baseScore + (idx === scoreUnits.length - 1 ? remainder : 0)]));
    const scoredSubtasks = new Set();
    const tx = db.transaction(() => {
      if (replace) clearProblemCases(problemId);
      if (checkerSource.trim()) {
        writeCheckerSource(problemId, checkerSource);
        db.prepare("UPDATE problems SET checker_mode = 'special_judge', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(problemId);
      }
      pairs.forEach((item, idx) => {
        const sort = startSort + idx;
        const safeStem = sanitizeDataFileName(item.rawStem || String(sort)).replace(/\.(in|out|ans)$/i, '') || String(sort);
        const inputFile = `${sort}_${safeStem}.in`;
        const outputFile = `${sort}_${safeStem}.out`;
        fs.writeFileSync(path.join(dir, inputFile), item.input);
        fs.writeFileSync(path.join(dir, outputFile), item.output);
        let score = 0;
        if (autoScore && item.subtask) {
          score = scoredSubtasks.has(item.subtask) ? 0 : unitScores.get(`subtask:${item.subtask}`) || 0;
          scoredSubtasks.add(item.subtask);
        } else if (autoScore) {
          score = unitScores.get(`case:${idx}`) || 0;
        }
        db.prepare('INSERT INTO problem_cases (problem_id, input_path, output_path, subtask, score, sort, time_limit, memory_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(problemId, caseRelativePath(problemId, inputFile), caseRelativePath(problemId, outputFile), item.subtask || '', score, sort, 0, 0);
      });
    });
    tx();
    return res.json({ ok: true, imported: pairs.length, ignored, missing, replace, autoScore, subtaskMode, checkerImported: Boolean(checkerSource.trim()) });
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
    const existingSubtaskScore = subtask ? subtaskScore(problemId, subtask) : 0;
    const requestedScore = caseScore(req.body.score);
    const score = subtask ? (requestedScore || existingSubtaskScore) : requestedScore;
    const timeLimit = caseTimeLimit(req.body.timeLimit);
    const memoryLimit = caseMemoryLimit(req.body.memoryLimit);
    const nextSort = Number(req.body.sort) || (db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM problem_cases WHERE problem_id = ?').get(problemId).s || 1);
    const dir = ensureProblemDir(problemId);
    const inputFile = `${nextSort}.in`;
    const outputFile = `${nextSort}.out`;
    fs.writeFileSync(path.join(dir, inputFile), input);
    fs.writeFileSync(path.join(dir, outputFile), output);
    const info = db.prepare('INSERT INTO problem_cases (problem_id, input_path, output_path, subtask, score, sort, time_limit, memory_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(problemId, caseRelativePath(problemId, inputFile), caseRelativePath(problemId, outputFile), subtask, score, nextSort, timeLimit, memoryLimit);
    if (subtask) rebalanceSubtaskScores(problemId, subtask, info.lastInsertRowid, score);
    res.json({ case: { id: info.lastInsertRowid, problemId, subtask, score, sort: nextSort } });
  } catch (err) { return sendRouteError(res, err, next); }
});

router.put('/:id/cases/bulk', requireAdmin, (req, res, next) => {
  try {
    const problemId = getParamId(req);
    const problem = db.prepare('SELECT * FROM problems WHERE id = ?').get(problemId);
    if (!problem) return res.status(404).json({ error: '题目不存在' });
    const items = Array.isArray(req.body.cases) ? req.body.cases : [];
    if (!items.length) return res.status(400).json({ error: '请提供测试点配置' });
    const existingRows = db.prepare('SELECT id FROM problem_cases WHERE problem_id = ?').all(problemId);
    const existingIds = new Set(existingRows.map((row) => Number(row.id)));
    const seen = new Set();
    const normalized = items.map((item, idx) => {
      const id = Number(item.id);
      if (!existingIds.has(id)) throw Object.assign(new Error(`测试点不存在：${id}`), { status: 400 });
      if (seen.has(id)) throw Object.assign(new Error(`测试点重复：${id}`), { status: 400 });
      seen.add(id);
      return {
        id,
        subtask: sanitizeSubtaskName(item.subtask),
        score: caseScore(item.score),
        sort: Number(item.sort) || idx + 1,
        timeLimit: caseTimeLimit(item.timeLimit),
        memoryLimit: caseMemoryLimit(item.memoryLimit),
      };
    });

    const tx = db.transaction(() => {
      const update = db.prepare('UPDATE problem_cases SET subtask = ?, score = ?, sort = ?, time_limit = ?, memory_limit = ? WHERE id = ? AND problem_id = ?');
      for (const item of normalized) {
        update.run(item.subtask, item.subtask ? 0 : item.score, item.sort, item.timeLimit, item.memoryLimit, item.id, problemId);
      }
      const groups = new Map();
      for (const item of normalized) {
        if (!item.subtask) continue;
        if (!groups.has(item.subtask)) groups.set(item.subtask, []);
        groups.get(item.subtask).push(item);
      }
      for (const group of groups.values()) {
        group.sort((a, b) => a.sort - b.sort || a.id - b.id);
        const score = caseScore(group.find((item) => caseScore(item.score) > 0)?.score ?? group[0]?.score);
        rebalanceSubtaskScores(problemId, group[0].subtask, group[0].id, score);
      }
    });
    tx();
    const rows = db.prepare('SELECT * FROM problem_cases WHERE problem_id = ? ORDER BY sort, id').all(problemId);
    res.json({ ok: true, cases: rows.map(caseFromRow) });
  } catch (err) { return sendRouteError(res, err, next); }
});

router.put('/:id/cases/:caseId', requireAdmin, (req, res, next) => {
  try {
    const problemId = getParamId(req);
    const caseId = Number(req.params.caseId);
    const row = db.prepare('SELECT * FROM problem_cases WHERE id = ? AND problem_id = ?').get(caseId, problemId);
    if (!row) return res.status(404).json({ error: '测试点不存在' });
    const oldSubtask = row.subtask || '';
    const sort = Number(req.body.sort ?? row.sort) || row.sort;
    const subtask = req.body.subtask === undefined ? (row.subtask || '') : sanitizeSubtaskName(req.body.subtask);
    const existingGroupScore = subtask ? subtaskScore(problemId, subtask) : 0;
    const score = caseScore(req.body.score ?? (subtask ? existingGroupScore : row.score));
    const timeLimit = req.body.timeLimit === undefined ? (row.time_limit || 0) : caseTimeLimit(req.body.timeLimit);
    const memoryLimit = req.body.memoryLimit === undefined ? (row.memory_limit || 0) : caseMemoryLimit(req.body.memoryLimit);
    if (req.body.input !== undefined) fs.writeFileSync(absoluteDataPath(row.input_path), String(req.body.input));
    if (req.body.output !== undefined) fs.writeFileSync(absoluteDataPath(row.output_path), String(req.body.output));
    db.prepare('UPDATE problem_cases SET subtask = ?, score = ?, sort = ?, time_limit = ?, memory_limit = ? WHERE id = ?').run(subtask, subtask ? 0 : score, sort, timeLimit, memoryLimit, caseId);
    if (oldSubtask && oldSubtask !== subtask) rebalanceSubtaskScores(problemId, oldSubtask);
    if (subtask) rebalanceSubtaskScores(problemId, subtask, caseId, score);
    res.json({ case: caseWithSubtaskScore(problemId, db.prepare('SELECT * FROM problem_cases WHERE id = ?').get(caseId)) });
  } catch (err) { return sendRouteError(res, err, next); }
});

router.delete('/:id/cases/:caseId', requireAdmin, (req, res, next) => {
  try {
    const problemId = getParamId(req);
    const caseId = Number(req.params.caseId);
    const row = db.prepare('SELECT * FROM problem_cases WHERE id = ? AND problem_id = ?').get(caseId, problemId);
    if (!row) return res.status(404).json({ error: '测试点不存在' });
    const oldSubtaskScore = row.subtask ? subtaskScore(problemId, row.subtask) : 0;
    db.prepare('DELETE FROM problem_cases WHERE id = ?').run(caseId);
    if (row.subtask) rebalanceSubtaskScores(problemId, row.subtask, null, oldSubtaskScore);
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
    if (!['cpp11', 'cpp14', 'cpp17', 'c', 'python'].includes(language)) return res.status(400).json({ error: '不支持的语言' });
    const optimize = ['cpp11', 'cpp14', 'cpp17'].includes(language) && (req.body.o2 === undefined ? true : parseBoolean(req.body.o2, true));
    if (!code.trim()) return res.status(400).json({ error: '代码不能为空' });
    const info = db.prepare(`INSERT INTO submissions (user_id, problem_id, language, code, optimize, status)
      VALUES (?, ?, ?, ?, ?, 'Waiting')`).run(req.user.id, problemId, language, code, boolToInt(optimize));
    res.json({ submissionId: info.lastInsertRowid });
  } catch (err) { return sendRouteError(res, err, next); }
});

module.exports = router;
