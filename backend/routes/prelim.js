const express = require('express');
const multer = require('multer');
const { db, parseJson } = require('../db');
const { requireAdmin } = require('../auth');
const {
  SECTION_LABELS,
  normalizeGroupName,
  answerToStored,
  storedAnswerLabel,
  parsePaperQuestions,
  prelimQuestionFromRow,
  prelimGroupFromRow,
  questionFromRow,
  tagNamesFromJson,
} = require('../prelim-utils');
const { normalizeTagList, resolveTagQuery, syncPrelimQuestionTags } = require('../tag-service');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.PRELIM_MD_LIMIT || 2) * 1024 * 1024 } });

function boolToInt(v) { return v ? 1 : 0; }
function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'on', 'yes'].includes(String(value).toLowerCase());
}
function routeError(res, err, next) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  return next(err);
}
function latestUserAnswerSql(userId, questionIdExpr = 'q.id') {
  if (!userId) return 'NULL';
  return `(SELECT aa.selected_answer FROM prelim_attempts aa WHERE aa.question_id = ${questionIdExpr} AND aa.user_id = ${Number(userId)} ORDER BY aa.id DESC LIMIT 1)`;
}
function latestUserResultSql(userId, questionIdExpr = 'q.id') {
  if (!userId) return 'NULL';
  return `(SELECT aa.is_correct FROM prelim_attempts aa WHERE aa.question_id = ${questionIdExpr} AND aa.user_id = ${Number(userId)} ORDER BY aa.id DESC LIMIT 1)`;
}

function groupSelectSql(userId = 0) {
  const uid = Number(userId) || 0;
  return `SELECT g.*, p.title AS paper_title, p.year, p.group_name, p.round_name,
      MIN(q.number) AS first_question_number,
      COUNT(DISTINCT q.id) AS question_count,
      COALESCE(SUM(q.score), 0) AS score,
      COUNT(a.id) AS attempt_count,
      COUNT(CASE WHEN a.is_correct = 1 THEN 1 END) AS correct_count,
      ${uid ? `(SELECT COUNT(*) FROM prelim_questions qq WHERE qq.group_id = g.id AND EXISTS (SELECT 1 FROM prelim_attempts aa WHERE aa.question_id = qq.id AND aa.user_id = ${uid}))` : '0'} AS user_attempted_count,
      ${uid ? `(SELECT COUNT(*) FROM prelim_questions qq WHERE qq.group_id = g.id AND (${latestUserResultSql(uid, 'qq.id')}) = 1)` : '0'} AS user_correct_count,
      ${uid ? `(SELECT COUNT(*) FROM prelim_questions qq WHERE qq.group_id = g.id AND (${latestUserResultSql(uid, 'qq.id')}) = 0)` : '0'} AS user_wrong_count
    FROM prelim_groups g
    JOIN prelim_papers p ON p.id = g.paper_id
    LEFT JOIN prelim_questions q ON q.group_id = g.id
    LEFT JOIN prelim_attempts a ON a.question_id = q.id`;
}

function selectGroups(req, adminMode = false) {
  const userId = req.user?.id || 0;
  const where = [];
  const params = [];
  if (!adminMode) where.push('g.is_public = 1');
  if (req.query.paperId) { where.push('g.paper_id = ?'); params.push(Number(req.query.paperId)); }
  if (req.query.year) { where.push('p.year = ?'); params.push(Number(req.query.year)); }
  if (req.query.groupName) { where.push('p.group_name = ?'); params.push(normalizeGroupName(req.query.groupName)); }
  if (req.query.section) { where.push('g.section = ?'); params.push(String(req.query.section)); }
  if (req.query.tag) {
    const tagSlug = resolveTagQuery(db, req.query.tag);
    if (tagSlug) {
      where.push(`EXISTS (
        SELECT 1 FROM prelim_questions tq
        JOIN oj_prelim_question_tags tqt ON tqt.question_id = tq.id
        WHERE tq.group_id = g.id AND tqt.tag_slug = ?
      )`);
      params.push(tagSlug);
    }
  }
  if (req.query.keyword) {
    const kw = `%${String(req.query.keyword).trim()}%`;
    where.push(`(
      CAST(p.year AS TEXT) LIKE ?
      OR p.title LIKE ?
      OR p.group_name LIKE ?
      OR p.round_name LIKE ?
      OR g.title LIKE ?
      OR g.section_title LIKE ?
      OR g.group_no LIKE ?
      OR g.stem LIKE ?
      OR g.code LIKE ?
      OR EXISTS (
        SELECT 1 FROM prelim_questions kq
        WHERE kq.group_id = g.id AND (
          CAST(kq.number AS TEXT) LIKE ?
          OR kq.question_type LIKE ?
          OR kq.stem LIKE ?
          OR kq.options_json LIKE ?
          OR kq.explanation LIKE ?
          OR EXISTS (
            SELECT 1 FROM oj_prelim_question_tags kqt
            JOIN oj_tags kt ON kt.slug = kqt.tag_slug
            WHERE kqt.question_id = kq.id AND (kt.slug LIKE ? OR kt.name_zh LIKE ?)
          )
        )
      )
    )`);
    params.push(kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw);
  }
  if (userId && req.query.status) {
    if (req.query.status === 'correct') where.push(`(SELECT COUNT(*) FROM prelim_questions sq WHERE sq.group_id = g.id AND (${latestUserResultSql(userId, 'sq.id')}) = 1) = (SELECT COUNT(*) FROM prelim_questions sq2 WHERE sq2.group_id = g.id)`);
    if (req.query.status === 'wrong') where.push(`EXISTS (SELECT 1 FROM prelim_questions sq WHERE sq.group_id = g.id AND (${latestUserResultSql(userId, 'sq.id')}) = 0)`);
    if (req.query.status === 'todo') where.push(`NOT EXISTS (SELECT 1 FROM prelim_questions sq WHERE sq.group_id = g.id AND EXISTS (SELECT 1 FROM prelim_attempts aa WHERE aa.question_id = sq.id AND aa.user_id = ${Number(userId)}))`);
    if (req.query.status === 'partial') where.push(`(SELECT COUNT(*) FROM prelim_questions sq WHERE sq.group_id = g.id AND EXISTS (SELECT 1 FROM prelim_attempts aa WHERE aa.question_id = sq.id AND aa.user_id = ${Number(userId)})) BETWEEN 1 AND (SELECT COUNT(*) - 1 FROM prelim_questions sq2 WHERE sq2.group_id = g.id)`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`${groupSelectSql(userId)} ${whereSql}
    GROUP BY g.id
    ORDER BY p.year DESC, p.group_name ASC, p.id DESC, g.sort_order ASC, g.number ASC`).all(...params);
  return rows.map(prelimGroupFromRow);
}

function getQuestionsForGroup(groupId, userId = 0, includeAnswer = false) {
  const rows = db.prepare(`SELECT q.*,
      COUNT(a.id) AS attempt_count,
      COUNT(CASE WHEN a.is_correct = 1 THEN 1 END) AS correct_count,
      ${latestUserResultSql(userId)} AS user_result,
      ${latestUserAnswerSql(userId)} AS user_answer
    FROM prelim_questions q
    LEFT JOIN prelim_attempts a ON a.question_id = q.id
    WHERE q.group_id = ?
    GROUP BY q.id
    ORDER BY q.sort_order ASC, q.number ASC`).all(Number(groupId));
  return rows.map((row) => {
    const q = questionFromRow(row);
    q.attemptCount = row.attempt_count || 0;
    q.correctCount = row.correct_count || 0;
    q.userResult = row.user_result ?? null;
    q.userAnswer = row.user_answer ?? null;
    if (!includeAnswer) {
      delete q.answer;
      delete q.answerLabel;
      delete q.explanation;
    }
    return q;
  });
}

function getGroup(id, userId = 0, adminMode = false) {
  const rows = db.prepare(`${groupSelectSql(userId)} WHERE g.id = ? GROUP BY g.id`).all(Number(id));
  const group = prelimGroupFromRow(rows[0]);
  if (!group) return null;
  if (!group.isPublic && !adminMode) return { forbidden: true };
  group.questions = getQuestionsForGroup(group.id, userId, adminMode);
  return group;
}

function questionDetail(id, userId = 0) {
  const rows = db.prepare(`SELECT q.*, g.section, g.section_title, g.group_no, g.code, g.is_public, p.title AS paper_title, p.year, p.group_name, p.round_name,
      COUNT(a.id) AS attempt_count,
      COUNT(CASE WHEN a.is_correct = 1 THEN 1 END) AS correct_count,
      ${latestUserResultSql(userId)} AS user_result,
      ${latestUserAnswerSql(userId)} AS user_answer
    FROM prelim_questions q
    JOIN prelim_groups g ON g.id = q.group_id
    JOIN prelim_papers p ON p.id = q.paper_id
    LEFT JOIN prelim_attempts a ON a.question_id = q.id
    WHERE q.id = ?
    GROUP BY q.id`).all(Number(id));
  return prelimQuestionFromRow(rows[0]);
}

function importParsedPaper(parsed, options = {}) {
  const paper = parsed.paper;
  const replace = Boolean(options.replace);
  if (!parsed.groups?.length) {
    const err = new Error('没有从试卷中解析到题目');
    err.status = 400;
    throw err;
  }
  const existing = db.prepare('SELECT id FROM prelim_papers WHERE year = ? AND group_name = ? AND round_name = ?')
    .get(paper.year, paper.groupName, paper.roundName);
  if (existing && !replace) {
    const err = new Error('同年份、组别、轮次的初赛试卷已存在；请勾选覆盖导入');
    err.status = 409;
    throw err;
  }
  const tx = db.transaction(() => {
    if (existing && replace) db.prepare('DELETE FROM prelim_papers WHERE id = ?').run(existing.id);
    const paperInfo = db.prepare('INSERT INTO prelim_papers (year, group_name, round_name, title, total_score) VALUES (?, ?, ?, ?, ?)')
      .run(paper.year, paper.groupName, paper.roundName, paper.title, paper.totalScore);
    const paperId = paperInfo.lastInsertRowid;
    const insertGroup = db.prepare(`INSERT INTO prelim_groups
      (paper_id, number, section, group_no, title, section_title, stem, code, tags_json, is_public, sort_order, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`);
    const insertQuestion = db.prepare(`INSERT INTO prelim_questions
      (group_id, paper_id, number, question_type, stem, score, options_json, answer, explanation, tags_json, sort_order, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`);
    for (const g of parsed.groups) {
      const groupTags = normalizeTagList(g.tags || []);
      const gInfo = insertGroup.run(
        paperId,
        g.number,
        g.section,
        g.groupNo || '',
        g.title || '',
        g.sectionTitle || '',
        g.stem || '',
        g.code || '',
        JSON.stringify(groupTags),
        1,
        g.sortOrder || g.firstQuestionNumber || g.number,
      );
      const groupId = gInfo.lastInsertRowid;
      for (const q of g.questions || []) {
        const normalizedTags = normalizeTagList(q.tags || []);
        const qInfo = insertQuestion.run(
          groupId,
          paperId,
          q.number,
          q.questionType,
          q.stem || '',
          q.score || 0,
          JSON.stringify(q.options || []),
          q.answer || '',
          q.explanation || '',
          JSON.stringify(normalizedTags),
          q.sortOrder || q.number,
        );
        syncPrelimQuestionTags(db, qInfo.lastInsertRowid, normalizedTags, 'imported');
      }
    }
    return paperId;
  });
  return tx();
}

router.get('/papers', (req, res) => {
  const rows = db.prepare(`SELECT p.*, COUNT(DISTINCT g.id) AS group_count, COUNT(DISTINCT q.id) AS question_count
    FROM prelim_papers p
    LEFT JOIN prelim_groups g ON g.paper_id = p.id
    LEFT JOIN prelim_questions q ON q.paper_id = p.id
    GROUP BY p.id ORDER BY p.year DESC, p.group_name ASC, p.id DESC`).all();
  res.json({ papers: rows.map((p) => ({
    id: p.id,
    year: p.year,
    groupName: p.group_name,
    roundName: p.round_name,
    title: p.title,
    totalScore: p.total_score,
    groupCount: p.group_count || 0,
    questionCount: p.question_count || 0,
    createdAt: p.created_at,
  })) });
});

router.get('/facets', (req, res) => {
  const includeHidden = req.user?.role === 'admin' && req.query.all === '1';
  const visibilitySql = includeHidden ? '' : 'WHERE g.is_public = 1';
  const rows = db.prepare(`SELECT p.year, p.group_name, g.section, q.question_type, g.tags_json
    FROM prelim_groups g JOIN prelim_papers p ON p.id = g.paper_id
    LEFT JOIN prelim_questions q ON q.group_id = g.id ${visibilitySql}`).all();
  const years = new Set();
  const groups = new Set();
  const sections = new Set();
  const tags = new Set();
  for (const row of rows) {
    years.add(row.year);
    groups.add(row.group_name);
    sections.add(row.section);
    for (const tag of tagNamesFromJson(parseJson(row.tags_json, []))) tags.add(tag);
  }
  const tagRows = db.prepare(`SELECT DISTINCT t.slug, t.name_zh
    FROM prelim_groups g
    JOIN prelim_questions q ON q.group_id = g.id
    JOIN oj_prelim_question_tags qt ON qt.question_id = q.id
    JOIN oj_tags t ON t.slug = qt.tag_slug
    ${visibilitySql}
    ORDER BY t.sort_order ASC, t.name_zh ASC`).all();
  res.json({
    years: [...years].sort((a, b) => b - a),
    groups: [...groups].sort(),
    sections: [...sections].sort(),
    tags: tagRows.length
      ? tagRows.map((tag) => ({ value: tag.slug, label: tag.name_zh, slug: tag.slug, name: tag.name_zh }))
      : [...tags].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    sectionLabels: SECTION_LABELS,
  });
});

router.get('/items', (req, res) => {
  const adminMode = req.user?.role === 'admin' && req.query.all === '1';
  res.json({ items: selectGroups(req, adminMode) });
});

router.get('/items/:id', (req, res) => {
  const group = getGroup(req.params.id, req.user?.id || 0, req.user?.role === 'admin');
  if (!group) return res.status(404).json({ error: '初赛题目不存在' });
  if (group.forbidden) return res.status(403).json({ error: '题目未公开' });
  res.json({ item: group });
});

router.get('/questions', (req, res) => {
  const adminMode = req.user?.role === 'admin' && req.query.all === '1';
  const rows = db.prepare(`SELECT q.*, g.section, g.section_title, g.group_no, g.code, g.is_public, p.title AS paper_title, p.year, p.group_name, p.round_name,
      COUNT(a.id) AS attempt_count,
      COUNT(CASE WHEN a.is_correct = 1 THEN 1 END) AS correct_count,
      ${latestUserResultSql(req.user?.id || 0)} AS user_result,
      ${latestUserAnswerSql(req.user?.id || 0)} AS user_answer
    FROM prelim_questions q JOIN prelim_groups g ON g.id = q.group_id JOIN prelim_papers p ON p.id = q.paper_id
    LEFT JOIN prelim_attempts a ON a.question_id = q.id
    ${adminMode ? '' : 'WHERE g.is_public = 1'}
    GROUP BY q.id ORDER BY p.year DESC, p.group_name ASC, g.sort_order ASC, q.sort_order ASC`).all();
  const questions = rows.map(prelimQuestionFromRow).map((q) => {
    if (!adminMode) { delete q.answer; delete q.explanation; }
    return q;
  });
  res.json({ questions });
});

router.get('/questions/:id', (req, res) => {
  const q = questionDetail(req.params.id, req.user?.id || 0);
  if (!q) return res.status(404).json({ error: '初赛小题不存在' });
  if (!q.isPublic && req.user?.role !== 'admin') return res.status(403).json({ error: '题目未公开' });
  if (req.user?.role !== 'admin') { delete q.answer; delete q.explanation; }
  res.json({ question: q });
});

router.get('/papers/:id', (req, res) => {
  const paperId = Number(req.params.id);
  const paper = db.prepare('SELECT * FROM prelim_papers WHERE id = ?').get(paperId);
  if (!paper) return res.status(404).json({ error: '试卷不存在' });
  const groups = selectGroups({ ...req, query: { ...req.query, paperId } }, req.user?.role === 'admin')
    .map((g) => ({ ...g, questions: getQuestionsForGroup(g.id, req.user?.id || 0, req.user?.role === 'admin') }));
  res.json({ paper: {
    id: paper.id,
    year: paper.year,
    groupName: paper.group_name,
    roundName: paper.round_name,
    title: paper.title,
    totalScore: paper.total_score,
    createdAt: paper.created_at,
  }, groups });
});

router.post('/questions/:id/check', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = db.prepare(`SELECT q.*, g.is_public FROM prelim_questions q JOIN prelim_groups g ON g.id = q.group_id WHERE q.id = ?`).get(id);
    if (!row) return res.status(404).json({ error: '初赛小题不存在' });
    if (!row.is_public && req.user?.role !== 'admin') return res.status(403).json({ error: '题目未公开' });
    const selected = answerToStored(req.body.answer);
    if (!selected) return res.status(400).json({ error: '请选择答案' });
    const correct = selected === row.answer;
    if (req.user) db.prepare('INSERT INTO prelim_attempts (user_id, question_id, selected_answer, is_correct) VALUES (?, ?, ?, ?)')
      .run(req.user.id, id, selected, boolToInt(correct));
    const tags = parseJson(row.tags_json, []);
    res.json({
      correct,
      selectedAnswer: selected,
      selectedAnswerLabel: storedAnswerLabel(selected),
      answer: row.answer,
      answerLabel: storedAnswerLabel(row.answer),
      explanation: row.explanation,
      tags,
    });
  } catch (err) { return routeError(res, err, next); }
});

router.post('/import-md', requireAdmin, upload.fields([{ name: 'paper', maxCount: 1 }, { name: 'solution', maxCount: 1 }]), (req, res, next) => {
  try {
    const paperFile = req.files?.paper?.[0];
    const solutionFile = req.files?.solution?.[0];
    if (!paperFile || !solutionFile) return res.status(400).json({ error: '请同时上传试卷 Markdown 和答案解析 Markdown' });
    const parsed = parsePaperQuestions(paperFile.buffer.toString('utf8'), solutionFile.buffer.toString('utf8'), {
      year: req.body.year,
      groupName: req.body.groupName,
      roundName: req.body.roundName || '初赛',
      title: req.body.title,
      totalScore: req.body.totalScore || 100,
    });
    const summary = {
      paper: parsed.paper,
      itemCount: parsed.groups.length,
      questionCount: parsed.questions.length,
      sectionCount: parsed.groups.reduce((acc, g) => { acc[g.section] = (acc[g.section] || 0) + 1; return acc; }, {}),
      missingAnswerNumbers: parsed.questions.filter((q) => !q.answer).map((q) => q.number),
      previewItems: parsed.groups.slice(0, 8).map((g) => ({ title: g.title, section: g.section, questionCount: g.questions.length, score: g.score, tags: g.tags })),
    };
    if (parseBoolean(req.body.preview, false)) return res.json({ preview: summary });
    const paperId = importParsedPaper(parsed, { replace: parseBoolean(req.body.replace, false) });
    res.json({ ok: true, paperId, ...summary });
  } catch (err) { return routeError(res, err, next); }
});

router.delete('/papers/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM prelim_papers WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true, changed: info.changes });
});

router.post('/items/:id/status', requireAdmin, (req, res) => {
  const isPublic = parseBoolean(req.body.isPublic, true);
  const info = db.prepare('UPDATE prelim_groups SET is_public = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(boolToInt(isPublic), Number(req.params.id));
  res.json({ ok: true, changed: info.changes });
});
router.post('/questions/:id/status', requireAdmin, (req, res) => {
  const isPublic = parseBoolean(req.body.isPublic, true);
  const row = db.prepare('SELECT group_id FROM prelim_questions WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '初赛小题不存在' });
  const info = db.prepare('UPDATE prelim_groups SET is_public = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(boolToInt(isPublic), row.group_id);
  res.json({ ok: true, changed: info.changes });
});

function latestMockForPaper(userId, paperId) {
  if (!userId) return null;
  return db.prepare('SELECT * FROM prelim_mock_exams WHERE user_id = ? AND source_paper_id = ? AND status = ? ORDER BY id DESC LIMIT 1').get(userId, paperId, 'submitted');
}
function truthPaperTitle(paper) {
  const group = String(paper?.group_name || 'CSP-J');
  return `CSP-${paper?.year || ''}-${group.endsWith('J') ? 'J1' : 'S1'}-真题卷`;
}
function displayMockExamTitle(exam) {
  const title = String(exam?.title || '');
  if (exam?.source_paper_id || title.includes('模拟卷') || title.includes('初赛模考') || title.includes('自动模考')) {
    const paper = exam?.source_paper_id ? db.prepare('SELECT * FROM prelim_papers WHERE id = ?').get(exam.source_paper_id) : null;
    if (paper) return truthPaperTitle(paper);
    const groupName = normalizeGroupName(exam?.group_name || 'CSP-J');
    if (exam?.year) return truthPaperTitle({ year: exam.year, group_name: groupName });
    return title.replace(/模拟卷/g, '真题卷').replace(/初赛模考/g, '初赛真题卷').replace(/自动模考/g, '真题卷');
  }
  return title || 'CSP 初赛真题卷';
}
function scoreTotalForMock(paper, rawTotal) {
  const official = Number(paper?.total_score || 0);
  if (official > 0) return official;
  const raw = Number(rawTotal || 0);
  return Number.isFinite(raw) ? raw : 0;
}
function clampScoreToTotal(score, total) {
  const s = Number(score || 0);
  const t = Number(total || 0);
  if (!Number.isFinite(s)) return 0;
  if (t > 0 && s > t) return t;
  return s;
}

router.get('/mock/papers', (req, res) => {
  const userId = req.user?.id || 0;
  const rows = db.prepare(`SELECT p.*, COUNT(DISTINCT g.id) AS group_count, COUNT(DISTINCT q.id) AS question_count, p.total_score AS total_score
    FROM prelim_papers p LEFT JOIN prelim_groups g ON g.paper_id = p.id AND g.is_public = 1 LEFT JOIN prelim_questions q ON q.group_id = g.id
    GROUP BY p.id ORDER BY p.year DESC, p.group_name ASC`).all();
  const papers = rows.map((p) => {
    const latest = latestMockForPaper(userId, p.id);
    return {
      id: p.id,
      title: truthPaperTitle(p),
      paperTitle: p.title,
      year: p.year,
      groupName: p.group_name,
      questionCount: p.question_count || 0,
      groupCount: p.group_count || 0,
      totalScore: p.total_score || 0,
      latest: latest ? {
        examId: latest.id,
        score: latest.score,
        totalScore: latest.total_score,
        submittedAt: latest.submitted_at,
        status: latest.status,
      } : null,
    };
  });
  res.json({ papers });
});

function selectMockGroupIds({ paperId, year, groupName }) {
  const where = ['g.is_public = 1'];
  const params = [];
  if (paperId) { where.push('g.paper_id = ?'); params.push(Number(paperId)); }
  if (year) { where.push('p.year = ?'); params.push(Number(year)); }
  if (groupName) { where.push('p.group_name = ?'); params.push(normalizeGroupName(groupName)); }
  const rows = db.prepare(`SELECT g.id, g.section, g.sort_order FROM prelim_groups g JOIN prelim_papers p ON p.id = g.paper_id WHERE ${where.join(' AND ')} ORDER BY p.year DESC, p.group_name ASC, g.sort_order ASC, g.id ASC`).all(...params);
  if (paperId) return rows.map((r) => r.id);
  const bySection = { single_choice: [], program_reading: [], code_completion: [] };
  for (const r of rows) if (bySection[r.section]) bySection[r.section].push(r.id);
  return [
    ...bySection.single_choice.slice(0, 15),
    ...bySection.program_reading.slice(0, 3),
    ...bySection.code_completion.slice(0, 3),
  ].filter(Boolean);
}

router.post('/mock/start', (req, res) => {
  const paperId = req.body.paperId ? Number(req.body.paperId) : 0;
  const paper = paperId ? db.prepare('SELECT * FROM prelim_papers WHERE id = ?').get(paperId) : null;
  const groupIds = selectMockGroupIds({ paperId, year: req.body.year || paper?.year, groupName: req.body.groupName || paper?.group_name });
  if (!groupIds.length) return res.status(400).json({ error: '题库中暂无可组卷的初赛题目' });
  const scoreRow = db.prepare(`SELECT COALESCE(SUM(q.score), 0) AS total FROM prelim_questions q WHERE q.group_id IN (${groupIds.map(() => '?').join(',')})`).get(...groupIds);
  const totalScore = scoreTotalForMock(paper, scoreRow.total);
  const title = req.body.title || (paper ? truthPaperTitle(paper) : 'CSP 初赛真题卷');
  const info = db.prepare(`INSERT INTO prelim_mock_exams (user_id, title, year, group_name, source_paper_id, group_ids_json, total_score)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    req.user?.id || null,
    title,
    paper?.year || Number(req.body.year) || null,
    paper?.group_name || normalizeGroupName(req.body.groupName || 'CSP-J'),
    paperId || null,
    JSON.stringify(groupIds),
    totalScore,
  );
  res.json({ ok: true, examId: info.lastInsertRowid });
});

function mockExamPayload(examId, includeAnswers = false) {
  const exam = db.prepare('SELECT * FROM prelim_mock_exams WHERE id = ?').get(Number(examId));
  if (!exam) return null;
  const groupIds = parseJson(exam.group_ids_json, []);
  const groups = groupIds.map((id) => getGroup(id, 0, true)).filter(Boolean).map((g) => {
    if (!includeAnswers) g.questions.forEach((q) => { delete q.answer; delete q.answerLabel; delete q.explanation; });
    return g;
  });
  return {
    exam: {
      id: exam.id,
      title: displayMockExamTitle(exam),
      year: exam.year,
      groupName: exam.group_name,
      sourcePaperId: exam.source_paper_id,
      score: exam.score,
      totalScore: exam.total_score,
      status: exam.status,
      startedAt: exam.started_at,
      submittedAt: exam.submitted_at,
      answers: includeAnswers ? parseJson(exam.answers_json, {}) : undefined,
    },
    groups,
  };
}

router.get('/mock/exams/:id', (req, res) => {
  const payload = mockExamPayload(req.params.id, false);
  if (!payload) return res.status(404).json({ error: '模考不存在' });
  res.json(payload);
});

router.post('/mock/exams/:id/submit', (req, res) => {
  const exam = db.prepare('SELECT * FROM prelim_mock_exams WHERE id = ?').get(Number(req.params.id));
  if (!exam) return res.status(404).json({ error: '模考不存在' });
  if (exam.status === 'submitted') return res.status(400).json({ error: '该模考已经提交' });
  const answers = req.body.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
  const groupIds = parseJson(exam.group_ids_json, []);
  if (!groupIds.length) return res.status(400).json({ error: '模考题目为空' });
  const questions = db.prepare(`SELECT q.id, q.answer, q.score FROM prelim_questions q WHERE q.group_id IN (${groupIds.map(() => '?').join(',')})`).all(...groupIds);
  let score = 0;
  const detail = {};
  for (const q of questions) {
    const selected = answerToStored(answers[q.id]);
    const correct = selected && selected === q.answer;
    if (correct) score += q.score || 0;
    detail[q.id] = { selectedAnswer: selected || '', correct: Boolean(correct), score: correct ? q.score || 0 : 0 };
    if (req.user && selected) db.prepare('INSERT INTO prelim_attempts (user_id, question_id, selected_answer, is_correct) VALUES (?, ?, ?, ?)')
      .run(req.user.id, q.id, selected, boolToInt(correct));
  }
  const finalScore = clampScoreToTotal(score, exam.total_score);
  db.prepare('UPDATE prelim_mock_exams SET status = ?, score = ?, answers_json = ?, submitted_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('submitted', finalScore, JSON.stringify(detail), exam.id);
  res.json({ ok: true, examId: exam.id, score: finalScore, rawScore: score, totalScore: exam.total_score, detail });
});

router.get('/mock/exams/:id/report', (req, res) => {
  const payload = mockExamPayload(req.params.id, true);
  if (!payload) return res.status(404).json({ error: '模考不存在' });
  res.json(payload);
});

module.exports = router;
module.exports.importParsedPaper = importParsedPaper;
