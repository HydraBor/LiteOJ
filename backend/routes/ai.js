const express = require('express');
const { db } = require('../db');
const { requireLogin } = require('../auth');
const { getAiSettings } = require('../settings');
const {
  AI_IDENTITY_PROMPT,
} = require('../ai-prompts');

const router = express.Router();

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
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sseStage(res, stage, label) {
  sse(res, 'stage', { stage, label });
}

function responseMessages(settings, sessionId, userMessageId, content) {
  const identityPrompt = settings.systemPrompt.includes('小轻') ? '' : `${AI_IDENTITY_PROMPT}\n\n`;
  const prompt = `${identityPrompt}${settings.systemPrompt}`;
  const messages = [{ role: 'system', content: prompt }];
  if (settings.contextMode === 'recent' && settings.contextRecentMessages > 0) {
    const recent = db.prepare(`SELECT role, content FROM ai_messages
      WHERE session_id = ? AND id <> ? AND role IN ('user', 'assistant')
      ORDER BY id DESC LIMIT ?`).all(sessionId, userMessageId, settings.contextRecentMessages).reverse();
    messages.push(...recent.map((row) => ({ role: row.role, content: row.content })));
  }
  messages.push({ role: 'user', content });
  return messages;
}

function reviewMessages(settings, firstReply) {
  return [{
    role: 'user',
    content: `${settings.reviewPrompt}\n\n【首次回复】\n${String(firstReply || '').trim()}`,
  }];
}

function currentApiKey(settings) {
  return process.env[settings.apiKeyEnv] || '';
}

async function streamOpenAiCompatible({ settings, messages, signal }) {
  const body = {
    model: settings.defaultModel,
    messages,
    max_tokens: settings.maxOutputTokens,
    stream: true,
  };
  if (settings.provider === 'xfyun') {
    body.enable_thinking = false;
  }
  return fetch(`${settings.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${currentApiKey(settings)}`,
    },
    body: JSON.stringify(body),
  });
}

async function collectOpenAiStream(upstream, onDelta, shouldStop = () => false) {
  const decoder = new TextDecoder();
  let lineBuffer = '';
  let content = '';
  let done = false;

  const handleLine = (line) => {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data) return;
    if (data === '[DONE]') {
      done = true;
      return;
    }
    try {
      const json = JSON.parse(data);
      const delta = json.choices?.[0]?.delta?.content || '';
      if (delta && !shouldStop()) {
        content += delta;
        onDelta?.(delta);
      }
    } catch (_) {}
  };

  for await (const chunk of upstream.body) {
    lineBuffer += decoder.decode(chunk, { stream: true });
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || '';
    lines.forEach(handleLine);
    if (done || shouldStop()) break;
  }
  if (lineBuffer && !shouldStop()) handleLine(lineBuffer);
  return content;
}

function startSse(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

function saveAssistantMessage(sessionId, userId, content, model) {
  const info = db.prepare(`INSERT INTO ai_messages (session_id, user_id, role, content, model)
    VALUES (?, ?, 'assistant', ?, ?)`).run(sessionId, userId, content, model);
  db.prepare('UPDATE ai_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(sessionId, userId);
  return info.lastInsertRowid;
}

router.get('/config', requireLogin, (_req, res) => {
  const settings = getAiSettings(db);
  res.json({
    enabled: settings.enabled,
    provider: settings.provider,
    providerLabel: settings.providerLabel,
    defaultModel: settings.defaultModel,
    maxInputChars: settings.maxInputChars,
    maxOutputTokens: settings.maxOutputTokens,
    contextMode: settings.contextMode,
    contextRecentMessages: settings.contextRecentMessages,
    hasApiKey: Boolean(currentApiKey(settings)),
    maxHistoryMbPerUser: settings.maxHistoryMbPerUser,
    ...quotaInfo(_req.user.id, settings),
  });
});

router.get('/sessions', requireLogin, (req, res) => {
  const sessions = db.prepare(`SELECT s.*,
      COUNT(m.id) AS message_count
    FROM ai_sessions s
    LEFT JOIN ai_messages m ON m.session_id = s.id
    WHERE s.user_id = ?
    GROUP BY s.id
    ORDER BY s.updated_at DESC, s.id DESC`).all(req.user.id).map(sessionFromRow);
  res.json({ sessions });
});

router.post('/sessions', requireLogin, (req, res) => {
  const title = cleanTitle(req.body.title);
  const info = db.prepare('INSERT INTO ai_sessions (user_id, title, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(req.user.id, title);
  const session = ownedSession(info.lastInsertRowid, req.user.id);
  res.status(201).json({ session: sessionFromRow(session) });
});

router.get('/sessions/:id', requireLogin, (req, res) => {
  const id = Number(req.params.id);
  const session = ownedSession(id, req.user.id);
  if (!session) return res.status(404).json({ error: 'AI 会话不存在' });
  const messages = db.prepare(`SELECT * FROM ai_messages
    WHERE session_id = ? AND user_id = ?
    ORDER BY id ASC`).all(id, req.user.id).map(messageFromRow);
  res.json({ session: sessionFromRow(session), messages });
});

router.patch('/sessions/:id', requireLogin, (req, res) => {
  const id = Number(req.params.id);
  if (!ownedSession(id, req.user.id)) return res.status(404).json({ error: 'AI 会话不存在' });
  db.prepare('UPDATE ai_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(cleanTitle(req.body.title), id, req.user.id);
  res.json({ session: sessionFromRow(ownedSession(id, req.user.id)) });
});

router.delete('/sessions/:id', requireLogin, (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM ai_sessions WHERE id = ? AND user_id = ?').run(id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'AI 会话不存在' });
  res.json({ ok: true, quota: quotaInfo(req.user.id, getAiSettings(db)) });
});

router.post('/sessions/batch-delete', requireLogin, (req, res) => {
  const ids = cleanSessionIds(req.body.ids);
  if (!ids.length) return res.status(400).json({ error: '请先选择要删除的会话' });
  const placeholders = ids.map(() => '?').join(',');
  const info = db.prepare(`DELETE FROM ai_sessions WHERE user_id = ? AND id IN (${placeholders})`).run(req.user.id, ...ids);
  res.json({ ok: true, deleted: info.changes, quota: quotaInfo(req.user.id, getAiSettings(db)) });
});

router.post('/sessions/:id/messages', requireLogin, async (req, res) => {
  const id = Number(req.params.id);
  const settings = getAiSettings(db);
  const session = ownedSession(id, req.user.id);
  if (!session) return res.status(404).json({ error: 'AI 会话不存在' });
  if (!settings.enabled) return res.status(403).json({ error: 'AI 对话功能未启用' });

  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: '消息不能为空' });
  if (content.length > settings.maxInputChars) return res.status(400).json({ error: `消息过长，最多 ${settings.maxInputChars} 个字符` });
  if (todayRequestCount(req.user.id) >= settings.maxRequestsPerUserPerDay) return res.status(429).json({ error: '今日 AI 请求次数已用完' });
  if (!currentApiKey(settings)) return res.status(503).json({ error: `服务器未配置 ${settings.apiKeyEnv}` });
  try {
    const reserveAssistantBytes = Math.max(8192, settings.maxOutputTokens * 8);
    ensureHistoryQuota(req.user.id, settings, textBytes(content) + reserveAssistantBytes);
  } catch (err) {
    return res.status(err.status || 413).json({ error: err.message, ...(err.quota || {}) });
  }

  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO ai_messages (session_id, user_id, role, content, model)
      VALUES (?, ?, 'user', ?, '')`).run(id, req.user.id, content);
    db.prepare('UPDATE ai_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(id, req.user.id);
    return info.lastInsertRowid;
  });
  const userMessageId = tx();

  const messages = responseMessages(settings, id, userMessageId, content);

  const controller = new AbortController();
  let clientClosed = false;
  res.on('close', () => {
    if (res.writableEnded) return;
    clientClosed = true;
    controller.abort();
  });

  startSse(res);
  sseStage(res, 'thinking', '小轻思考中');

  let upstream;
  try {
    upstream = await streamOpenAiCompatible({ settings, messages, signal: controller.signal });
  } catch (err) {
    if (!clientClosed) {
      sse(res, 'error', { error: `无法连接 ${settings.providerLabel} API`, detail: String(err.message || err) });
      res.end();
    }
    return null;
  }
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    if (!clientClosed) {
      sse(res, 'error', { error: `${settings.providerLabel} API 请求失败`, detail: text.slice(0, 500) });
      res.end();
    }
    return null;
  }

  try {
    const assistantContent = await collectOpenAiStream(upstream, (delta) => {
      if (!settings.reviewEnabled && !clientClosed) sse(res, 'delta', { content: delta });
    }, () => clientClosed);

    if (!clientClosed) {
      let finalContent = assistantContent;
      let finalModel = settings.defaultModel;
      if (settings.reviewEnabled) {
        let reviewUpstream;
        try {
          reviewUpstream = await streamOpenAiCompatible({
            settings,
            messages: reviewMessages(settings, assistantContent),
            signal: controller.signal,
          });
        } catch (err) {
          throw new Error(`无法连接 ${settings.providerLabel} 二次审查 API：${String(err.message || err)}`);
        }
        if (!reviewUpstream.ok) {
          const text = await reviewUpstream.text().catch(() => '');
          throw new Error(`${settings.providerLabel} 二次审查请求失败：${text.slice(0, 500)}`);
        }
        finalContent = await collectOpenAiStream(reviewUpstream, (delta) => {
          if (!clientClosed) sse(res, 'delta', { content: delta });
        }, () => clientClosed);
        if (clientClosed) return null;
        if (!finalContent.trim()) throw new Error(`${settings.providerLabel} 二次审查返回空内容`);
        finalModel = `${settings.defaultModel}:review`;
      }
      const messageId = saveAssistantMessage(id, req.user.id, finalContent, finalModel);
      sse(res, 'done', { messageId, content: finalContent, model: finalModel });
      res.end();
    }
  } catch (err) {
    if (!clientClosed) {
      sse(res, 'error', { error: 'AI 流式输出中断', detail: String(err.message || err) });
      res.end();
    }
  }
  return null;
});

module.exports = router;
