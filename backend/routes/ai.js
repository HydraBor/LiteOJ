const express = require('express');
const { db } = require('../db');
const { requireLogin } = require('../auth');
const { getAiSettings } = require('../settings');
const { AI_IDENTITY_PROMPT } = require('../ai-prompts');
const {
  AiProviderError,
  currentApiKey,
  estimatedDeepSeekCost,
  normalizeUsage,
  streamCompletion,
} = require('../ai-provider');

const router = express.Router();
const INTERRUPTED_REPLY = '本次回答生成中断，请稍后再试。';

function sessionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count ?? row.messageCount ?? 0,
  };
}

function messageFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    model: row.model || '',
    provider: row.provider || '',
    status: row.status || 'complete',
    isFallback: Boolean(row.is_fallback),
    finishReason: row.finish_reason || '',
    createdAt: row.created_at,
  };
}

function ownedSession(sessionId, userId) {
  return db.prepare('SELECT * FROM ai_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
}

function cleanTitle(value) {
  const title = String(value || '').trim().replace(/\s+/g, ' ');
  return title.slice(0, 80) || '新会话';
}

function todayRequestCount(userId) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ai_messages
    WHERE user_id = ? AND role = 'user' AND date(created_at, '+8 hours') = date('now', '+8 hours')`).get(userId).c;
}

function textBytes(value) {
  return Buffer.byteLength(String(value || ''), 'utf8');
}

function userHistoryUsedBytes(userId) {
  const row = db.prepare(`SELECT COALESCE(SUM(length(CAST(content AS BLOB))), 0) AS bytes
    FROM ai_messages WHERE user_id = ?`).get(userId);
  return Number(row?.bytes || 0);
}

function quotaInfo(userId, settings) {
  const limit = Number(settings.historyLimitBytesPerUser || 0);
  const used = userHistoryUsedBytes(userId);
  return {
    historyUsedBytes: used,
    historyLimitBytes: limit,
    historyRemainingBytes: Math.max(0, limit - used),
    historyUsagePercent: limit > 0 ? Math.min(100, Math.round((used / limit) * 1000) / 10) : 0,
  };
}

function ensureHistoryQuota(userId, settings, extraBytes) {
  const quota = quotaInfo(userId, settings);
  if (quota.historyLimitBytes > 0 && quota.historyUsedBytes + Number(extraBytes || 0) > quota.historyLimitBytes) {
    const err = new Error('小轻历史记录空间已满，请删除部分旧会话后再继续。');
    err.status = 413;
    err.quota = quota;
    throw err;
  }
  return quota;
}

function cleanSessionIds(value) {
  const ids = Array.isArray(value) ? value : [];
  return [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 200);
}

function sse(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sseStage(res, stage, label) {
  sse(res, 'stage', { stage, label });
}

function responseMessages(settings, sessionId, userMessageId, content, userRole) {
  const identityPrompt = settings.systemPrompt.includes('小轻') ? '' : `${AI_IDENTITY_PROMPT}\n\n`;
  const rolePrompt = userRole === 'admin'
    ? '\n\n【当前用户角色】管理员。可以根据管理员的明确要求提供完整代码，但仍需遵守安全、隐私和系统保护规则。'
    : '\n\n【当前用户角色】普通学生。严格执行教学式帮助和非代写边界。';
  const messages = [{ role: 'system', content: `${identityPrompt}${settings.systemPrompt}${rolePrompt}` }];
  if (settings.contextMode === 'recent' && settings.contextRecentMessages > 0) {
    const recent = db.prepare(`SELECT role, content FROM ai_messages
      WHERE session_id = ? AND id <> ? AND role IN ('user', 'assistant')
      ORDER BY id DESC LIMIT ?`).all(sessionId, userMessageId, settings.contextRecentMessages).reverse();
    messages.push(...recent.map((row) => ({ role: row.role, content: row.content })));
  }
  messages.push({ role: 'user', content });
  return messages;
}

function reviewMessages(settings, userRole, originalContent, generationMessages, firstReply) {
  const transcript = generationMessages
    .filter((message) => message.role !== 'system')
    .map((message) => `${message.role === 'assistant' ? '小轻' : '用户'}：${message.content}`)
    .join('\n\n');
  return [
    { role: 'system', content: settings.reviewPrompt },
    {
      role: 'user',
      content: `【当前用户角色】\n${userRole === 'admin' ? '管理员' : '普通学生'}\n\n【当前原始问题】\n${originalContent}\n\n【最近对话，仅供理解】\n${transcript}\n\n【待审查草稿】\n${String(firstReply || '').trim()}\n\n请只输出最终给用户看的回复。`,
    },
  ];
}

function providerConfigured(provider) {
  return Boolean(currentApiKey(provider));
}

function canUseFallback(settings) {
  return settings.provider === 'deepseek' && settings.fallbackToXfyun && providerConfigured('xfyun');
}

function canStartConversation(settings) {
  const generationAvailable = providerConfigured(settings.provider) || canUseFallback(settings);
  const reviewAvailable = !settings.reviewEnabled || providerConfigured(settings.reviewResolvedProvider);
  return generationAvailable && reviewAvailable;
}

function startSse(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

function completionMessageStatus(finishReason) {
  if (finishReason === 'length') return 'truncated';
  if (['content_filter', 'insufficient_system_resource'].includes(finishReason)) return 'interrupted';
  return 'complete';
}

function saveAssistantMessage(sessionId, userId, content, result = {}, status = 'complete') {
  const info = db.prepare(`INSERT INTO ai_messages
      (session_id, user_id, role, content, model, provider, status, is_fallback, finish_reason)
    VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)`)
    .run(sessionId, userId, content, result.model || '', result.provider || '', status, result.fallbackUsed ? 1 : 0, result.finishReason || '');
  db.prepare('UPDATE ai_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(sessionId, userId);
  return info.lastInsertRowid;
}

function recordUsageEvent({ userId, sessionId, phase, provider, model, status, httpStatus = 0, usage = {}, estimatedCostCny = 0, fallbackUsed = false, errorCode = '' }) {
  const normalized = normalizeUsage(usage);
  db.prepare(`INSERT INTO ai_usage_events
      (user_id, session_id, phase, provider, model, status, http_status,
       input_tokens, output_tokens, reasoning_tokens, cache_hit_tokens, cache_miss_tokens,
       estimated_cost_cny, fallback_used, error_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, sessionId, phase, provider || '', model || '', status, Number(httpStatus || 0),
      normalized.inputTokens, normalized.outputTokens, normalized.reasoningTokens,
      normalized.cacheHitTokens, normalized.cacheMissTokens, Number(estimatedCostCny || 0),
      fallbackUsed ? 1 : 0, String(errorCode || '').slice(0, 80));
}

function usageFromError(err) {
  return normalizeUsage(err?.partial?.usage || {});
}

async function runProviderAttempt({ settings, userId, sessionId, phase, provider, model, messages, signal, onDelta, fallbackUsed = false }) {
  try {
    const result = await streamCompletion({ settings, provider, model, messages, userId, signal, onDelta });
    if (!result.content.trim()) {
      throw new AiProviderError('上游模型返回了空内容', {
        provider: result.provider,
        model: result.model,
        code: 'empty_response',
        canFallback: result.provider === 'deepseek',
        partial: result,
      });
    }
    if (result.finishReason === 'insufficient_system_resource') {
      throw new AiProviderError('上游模型推理资源不足', {
        provider: result.provider,
        model: result.model,
        code: 'insufficient_system_resource',
        canFallback: result.provider === 'deepseek',
        partial: result,
      });
    }
    if (result.finishReason === 'stream_interrupted') {
      throw new AiProviderError('上游模型流式输出中断', {
        provider: result.provider,
        model: result.model,
        code: 'stream_interrupted',
        canFallback: result.provider === 'deepseek',
        partial: result,
      });
    }
    recordUsageEvent({
      userId, sessionId, phase, provider: result.provider, model: result.model,
      status: 'success', usage: result.usage, estimatedCostCny: result.estimatedCostCny,
      fallbackUsed,
    });
    return { ...result, fallbackUsed };
  } catch (err) {
    const providerName = err.provider || provider;
    const modelName = err.model || model || settings.providers?.[providerName]?.model || '';
    const partialUsage = usageFromError(err);
    recordUsageEvent({
      userId, sessionId, phase, provider: providerName, model: modelName,
      status: err.code === 'client_aborted' ? 'interrupted' : 'error',
      httpStatus: err.httpStatus, usage: partialUsage,
      estimatedCostCny: providerName === 'deepseek' ? estimatedDeepSeekCost(modelName, partialUsage) : 0,
      fallbackUsed, errorCode: err.code || 'upstream_error',
    });
    throw err;
  }
}

async function runGeneration({ settings, userId, sessionId, messages, signal, onDelta, outputHidden, onFallback }) {
  try {
    return await runProviderAttempt({
      settings, userId, sessionId, phase: 'generation', provider: settings.provider,
      model: settings.defaultModel, messages, signal, onDelta,
    });
  } catch (err) {
    const partialVisible = Boolean(err.partial?.content) && !outputHidden;
    const mayFallback = settings.provider === 'deepseek'
      && settings.fallbackToXfyun
      && err.canFallback
      && providerConfigured('xfyun')
      && !signal.aborted
      && !partialVisible;
    if (!mayFallback) throw err;
    onFallback?.();
    return runProviderAttempt({
      settings, userId, sessionId, phase: 'generation', provider: 'xfyun',
      model: settings.xfyunModel, messages, signal, onDelta, fallbackUsed: true,
    });
  }
}

function userUsageSummary(userId, days = 1) {
  const safeDays = Math.max(1, Math.min(365, Number(days) || 1));
  const since = `-${safeDays - 1} days`;
  const summary = db.prepare(`SELECT
      COUNT(*) AS upstreamCalls,
      COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS successfulCalls,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS failedCalls,
      COALESCE(SUM(fallback_used), 0) AS fallbackCalls,
      COALESCE(SUM(input_tokens), 0) AS inputTokens,
      COALESCE(SUM(output_tokens), 0) AS outputTokens,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoningTokens,
      COALESCE(SUM(cache_hit_tokens), 0) AS cacheHitTokens,
      COALESCE(SUM(estimated_cost_cny), 0) AS estimatedCostCny
    FROM ai_usage_events
    WHERE user_id = ? AND datetime(created_at, '+8 hours') >= datetime('now', '+8 hours', 'start of day', ?)`)
    .get(userId, since);
  return {
    ...summary,
    upstreamCalls: Number(summary.upstreamCalls || 0),
    successfulCalls: Number(summary.successfulCalls || 0),
    failedCalls: Number(summary.failedCalls || 0),
    fallbackCalls: Number(summary.fallbackCalls || 0),
    inputTokens: Number(summary.inputTokens || 0),
    outputTokens: Number(summary.outputTokens || 0),
    reasoningTokens: Number(summary.reasoningTokens || 0),
    cacheHitTokens: Number(summary.cacheHitTokens || 0),
    estimatedCostCny: Number(summary.estimatedCostCny || 0),
    days: safeDays,
  };
}

function userFacingError(err) {
  if (err?.code === 'client_aborted') return '本次回答生成中断';
  if (err?.code === 'invalid_request') return '小轻当前配置与上游模型不兼容，请联系管理员';
  if (['authentication_failed', 'missing_api_key', 'insufficient_balance'].includes(err?.code)) return '小轻暂时不可用，请联系管理员';
  if (['rate_limited', 'server_error', 'timeout', 'network_error', 'stream_interrupted', 'insufficient_system_resource'].includes(err?.code)) return '小轻现在有些忙，请稍后再试';
  return '小轻这次没有顺利完成回答，请稍后再试';
}

router.get('/config', requireLogin, (req, res) => {
  const settings = getAiSettings(db);
  const requestsUsedToday = todayRequestCount(req.user.id);
  res.json({
    enabled: settings.enabled,
    provider: settings.provider,
    providerLabel: settings.providerLabel,
    defaultModel: settings.defaultModel,
    deepseekThinkingEnabled: settings.deepseekThinkingEnabled,
    maxInputChars: settings.maxInputChars,
    maxOutputTokens: settings.maxOutputTokens,
    contextMode: settings.contextMode,
    contextRecentMessages: settings.contextRecentMessages,
    hasApiKey: canStartConversation(settings),
    primaryHasApiKey: providerConfigured(settings.provider),
    fallbackAvailable: canUseFallback(settings),
    reviewEnabled: settings.reviewEnabled,
    reviewProviderLabel: settings.reviewProviderLabel,
    reviewModel: settings.reviewModel,
    maxRequestsPerUserPerDay: settings.maxRequestsPerUserPerDay,
    requestsUsedToday,
    requestsRemainingToday: Math.max(0, settings.maxRequestsPerUserPerDay - requestsUsedToday),
    todayUsage: userUsageSummary(req.user.id, 1),
    maxHistoryMbPerUser: settings.maxHistoryMbPerUser,
    ...quotaInfo(req.user.id, settings),
  });
});

router.get('/usage', requireLogin, (req, res) => {
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
  const daily = db.prepare(`SELECT date(created_at, '+8 hours') AS date,
      COUNT(*) AS upstreamCalls,
      COALESCE(SUM(input_tokens), 0) AS inputTokens,
      COALESCE(SUM(output_tokens), 0) AS outputTokens,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoningTokens,
      COALESCE(SUM(estimated_cost_cny), 0) AS estimatedCostCny
    FROM ai_usage_events
    WHERE user_id = ? AND datetime(created_at, '+8 hours') >= datetime('now', '+8 hours', 'start of day', ?)
    GROUP BY date(created_at, '+8 hours') ORDER BY date ASC`)
    .all(req.user.id, `-${days - 1} days`);
  res.json({ summary: userUsageSummary(req.user.id, days), daily });
});

router.get('/sessions', requireLogin, (req, res) => {
  const sessions = db.prepare(`SELECT s.*, COUNT(m.id) AS message_count
    FROM ai_sessions s LEFT JOIN ai_messages m ON m.session_id = s.id
    WHERE s.user_id = ? GROUP BY s.id ORDER BY s.updated_at DESC, s.id DESC`)
    .all(req.user.id).map(sessionFromRow);
  res.json({ sessions });
});

router.post('/sessions', requireLogin, (req, res) => {
  const info = db.prepare('INSERT INTO ai_sessions (user_id, title, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .run(req.user.id, cleanTitle(req.body.title));
  res.status(201).json({ session: sessionFromRow(ownedSession(info.lastInsertRowid, req.user.id)) });
});

router.get('/sessions/:id', requireLogin, (req, res) => {
  const id = Number(req.params.id);
  const session = ownedSession(id, req.user.id);
  if (!session) return res.status(404).json({ error: 'AI 会话不存在' });
  const messages = db.prepare(`SELECT * FROM ai_messages WHERE session_id = ? AND user_id = ? ORDER BY id ASC`)
    .all(id, req.user.id).map(messageFromRow);
  return res.json({ session: sessionFromRow(session), messages });
});

router.patch('/sessions/:id', requireLogin, (req, res) => {
  const id = Number(req.params.id);
  if (!ownedSession(id, req.user.id)) return res.status(404).json({ error: 'AI 会话不存在' });
  db.prepare('UPDATE ai_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .run(cleanTitle(req.body.title), id, req.user.id);
  return res.json({ session: sessionFromRow(ownedSession(id, req.user.id)) });
});

router.delete('/sessions/:id', requireLogin, (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM ai_sessions WHERE id = ? AND user_id = ?').run(id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'AI 会话不存在' });
  return res.json({ ok: true, quota: quotaInfo(req.user.id, getAiSettings(db)) });
});

router.post('/sessions/batch-delete', requireLogin, (req, res) => {
  const ids = cleanSessionIds(req.body.ids);
  if (!ids.length) return res.status(400).json({ error: '请先选择要删除的会话' });
  const placeholders = ids.map(() => '?').join(',');
  const info = db.prepare(`DELETE FROM ai_sessions WHERE user_id = ? AND id IN (${placeholders})`).run(req.user.id, ...ids);
  return res.json({ ok: true, deleted: info.changes, quota: quotaInfo(req.user.id, getAiSettings(db)) });
});

router.post('/sessions/:id/messages', requireLogin, async (req, res) => {
  const id = Number(req.params.id);
  const settings = getAiSettings(db);
  if (!ownedSession(id, req.user.id)) return res.status(404).json({ error: 'AI 会话不存在' });
  if (!settings.enabled) return res.status(403).json({ error: 'AI 对话功能未启用' });

  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: '消息不能为空' });
  if (content.length > settings.maxInputChars) return res.status(400).json({ error: `消息过长，最多 ${settings.maxInputChars} 个字符` });
  if (todayRequestCount(req.user.id) >= settings.maxRequestsPerUserPerDay) return res.status(429).json({ error: '今日 AI 请求次数已用完' });
  if (!canStartConversation(settings)) {
    const missing = settings.reviewEnabled && !providerConfigured(settings.reviewResolvedProvider)
      ? `${settings.reviewApiKeyEnv}（审查模型）`
      : settings.apiKeyEnv;
    return res.status(503).json({ error: `服务器尚未正确配置 ${missing}` });
  }
  try {
    ensureHistoryQuota(req.user.id, settings, textBytes(content) + Math.max(8192, settings.maxOutputTokens * 8));
  } catch (err) {
    return res.status(err.status || 413).json({ error: err.message, ...(err.quota || {}) });
  }

  const userMessageId = db.transaction(() => {
    const info = db.prepare(`INSERT INTO ai_messages (session_id, user_id, role, content, model, status)
      VALUES (?, ?, 'user', ?, '', 'complete')`).run(id, req.user.id, content);
    db.prepare('UPDATE ai_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(id, req.user.id);
    return info.lastInsertRowid;
  })();
  const generationMessages = responseMessages(settings, id, userMessageId, content, req.user.role);

  const controller = new AbortController();
  let clientClosed = false;
  res.on('close', () => {
    if (res.writableEnded) return;
    clientClosed = true;
    controller.abort(new Error('client disconnected'));
  });

  startSse(res);
  sseStage(res, 'thinking', '小轻思考中');

  let visibleContent = '';
  let finalResult = null;
  try {
    const generation = await runGeneration({
      settings,
      userId: req.user.id,
      sessionId: id,
      messages: generationMessages,
      signal: controller.signal,
      outputHidden: settings.reviewEnabled,
      onFallback: () => sseStage(res, 'fallback', '正在切换备用模型'),
      onDelta: settings.reviewEnabled ? undefined : (delta) => {
        visibleContent += delta;
        sse(res, 'delta', { content: delta });
      },
    });

    if (settings.reviewEnabled) {
      if (controller.signal.aborted) throw new AiProviderError('用户已中断生成', { code: 'client_aborted', provider: generation.provider, model: generation.model });
      sseStage(res, 'reviewing', '小轻正在整理回答');
      const reviewed = await runProviderAttempt({
        settings,
        userId: req.user.id,
        sessionId: id,
        phase: 'review',
        provider: settings.reviewResolvedProvider,
        model: settings.reviewModel,
        messages: reviewMessages(settings, req.user.role, content, generationMessages, generation.content),
        signal: controller.signal,
        onDelta: (delta) => {
          visibleContent += delta;
          sse(res, 'delta', { content: delta });
        },
      });
      finalResult = { ...reviewed, fallbackUsed: Boolean(generation.fallbackUsed) };
    } else {
      finalResult = generation;
    }

    const status = completionMessageStatus(finalResult.finishReason);
    const finalContent = visibleContent.trim() ? visibleContent : finalResult.content;
    const messageId = saveAssistantMessage(id, req.user.id, finalContent, finalResult, status);
    if (!clientClosed) {
      sse(res, 'done', {
        messageId,
        content: finalContent,
        model: finalResult.model,
        provider: finalResult.provider,
        providerLabel: finalResult.providerLabel,
        fallbackUsed: Boolean(finalResult.fallbackUsed),
        status,
        finishReason: finalResult.finishReason,
      });
      res.end();
    }
  } catch (err) {
    const partial = visibleContent.trim();
    const interruptedResult = {
      provider: err.provider || finalResult?.provider || settings.provider,
      model: err.model || finalResult?.model || settings.defaultModel,
      finishReason: err.code || 'interrupted',
      fallbackUsed: Boolean(finalResult?.fallbackUsed),
    };
    saveAssistantMessage(id, req.user.id, partial || INTERRUPTED_REPLY, interruptedResult, 'interrupted');
    if (!clientClosed) {
      sse(res, 'error', { error: userFacingError(err), interrupted: true, partial: Boolean(partial) });
      res.end();
    }
  }
  return null;
});

module.exports = router;
module.exports.userUsageSummary = userUsageSummary;
