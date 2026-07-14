const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../auth');
const { hashPassword } = require('../passwords');
const { getAiSettings, saveAiSettings } = require('../settings');

const router = express.Router();
const DEFAULT_RESET_PASSWORD = '123456';

function aiKeyStatus(settings) {
  return {
    xfyun: Boolean(process.env.XFYUN_API_KEY),
    deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
    primary: Boolean(process.env[settings.apiKeyEnv]),
    review: Boolean(process.env[settings.reviewApiKeyEnv]),
  };
}

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

router.post('/users/:id/reset-password', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: '用户 ID 无效' });
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(DEFAULT_RESET_PASSWORD), id);
  res.json({ ok: true, password: DEFAULT_RESET_PASSWORD, user: { id: user.id, username: user.username } });
});

router.get('/ai-settings', requireAdmin, (_req, res) => {
  const settings = getAiSettings(db);
  const keyStatus = aiKeyStatus(settings);
  res.json({ settings, hasApiKey: keyStatus.primary, keyStatus });
});

router.put('/ai-settings', requireAdmin, (req, res) => {
  const settings = saveAiSettings(db, req.body);
  const keyStatus = aiKeyStatus(settings);
  res.json({ settings, hasApiKey: keyStatus.primary, keyStatus });
});

router.get('/ai-usage', requireAdmin, (req, res) => {
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
  const since = `-${days - 1} days`;
  const users = db.prepare(`SELECT u.id, u.username, u.role,
      (SELECT COUNT(*) FROM ai_messages m
        WHERE m.user_id = u.id AND m.role = 'user'
          AND datetime(m.created_at, '+8 hours') >= datetime('now', '+8 hours', 'start of day', ?)) AS userRequests,
      COUNT(e.id) AS upstreamCalls,
      COALESCE(SUM(CASE WHEN e.phase = 'generation' THEN 1 ELSE 0 END), 0) AS generationCalls,
      COALESCE(SUM(CASE WHEN e.phase = 'review' THEN 1 ELSE 0 END), 0) AS reviewCalls,
      COALESCE(SUM(CASE WHEN e.status = 'success' THEN 1 ELSE 0 END), 0) AS successfulCalls,
      COALESCE(SUM(CASE WHEN e.status = 'error' THEN 1 ELSE 0 END), 0) AS failedCalls,
      COALESCE(SUM(CASE WHEN e.status = 'interrupted' THEN 1 ELSE 0 END), 0) AS interruptedCalls,
      COALESCE(SUM(e.fallback_used), 0) AS fallbackCalls,
      COALESCE(SUM(e.input_tokens), 0) AS inputTokens,
      COALESCE(SUM(e.output_tokens), 0) AS outputTokens,
      COALESCE(SUM(e.reasoning_tokens), 0) AS reasoningTokens,
      COALESCE(SUM(e.cache_hit_tokens), 0) AS cacheHitTokens,
      COALESCE(SUM(e.cache_miss_tokens), 0) AS cacheMissTokens,
      COALESCE(SUM(e.estimated_cost_cny), 0) AS estimatedCostCny
    FROM users u
    LEFT JOIN ai_usage_events e ON e.user_id = u.id
      AND datetime(e.created_at, '+8 hours') >= datetime('now', '+8 hours', 'start of day', ?)
    GROUP BY u.id
    ORDER BY userRequests DESC, upstreamCalls DESC, u.id ASC`).all(since, since);
  const providers = db.prepare(`SELECT provider, model,
      COUNT(*) AS upstreamCalls,
      COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS successfulCalls,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS failedCalls,
      COALESCE(SUM(input_tokens), 0) AS inputTokens,
      COALESCE(SUM(output_tokens), 0) AS outputTokens,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoningTokens,
      COALESCE(SUM(cache_hit_tokens), 0) AS cacheHitTokens,
      COALESCE(SUM(estimated_cost_cny), 0) AS estimatedCostCny
    FROM ai_usage_events
    WHERE datetime(created_at, '+8 hours') >= datetime('now', '+8 hours', 'start of day', ?)
    GROUP BY provider, model ORDER BY upstreamCalls DESC`).all(since);
  const recentErrors = db.prepare(`SELECT e.created_at AS createdAt, e.phase, e.provider, e.model,
      e.status, e.http_status AS httpStatus, e.error_code AS errorCode, u.username
    FROM ai_usage_events e JOIN users u ON u.id = e.user_id
    WHERE e.status <> 'success'
      AND datetime(e.created_at, '+8 hours') >= datetime('now', '+8 hours', 'start of day', ?)
    ORDER BY e.id DESC LIMIT 20`).all(since);
  const summary = users.reduce((acc, row) => {
    for (const key of ['userRequests', 'upstreamCalls', 'generationCalls', 'reviewCalls', 'successfulCalls', 'failedCalls', 'interruptedCalls', 'fallbackCalls', 'inputTokens', 'outputTokens', 'reasoningTokens', 'cacheHitTokens', 'cacheMissTokens']) {
      acc[key] += Number(row[key] || 0);
    }
    acc.estimatedCostCny += Number(row.estimatedCostCny || 0);
    return acc;
  }, {
    userRequests: 0, upstreamCalls: 0, generationCalls: 0, reviewCalls: 0,
    successfulCalls: 0, failedCalls: 0, interruptedCalls: 0, fallbackCalls: 0,
    inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
    cacheHitTokens: 0, cacheMissTokens: 0, estimatedCostCny: 0,
  });
  res.json({ days, summary, users, providers, recentErrors });
});

module.exports = router;
