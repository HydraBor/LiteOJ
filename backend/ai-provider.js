const crypto = require('crypto');
const { providerSettings } = require('./settings');

const configuredTimeout = Number(process.env.AI_UPSTREAM_TIMEOUT_MS || 120000);
const UPSTREAM_TIMEOUT_MS = Number.isFinite(configuredTimeout) ? Math.max(15000, configuredTimeout) : 120000;

class AiProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AiProviderError';
    this.code = options.code || 'upstream_error';
    this.httpStatus = Number(options.httpStatus || 0);
    this.provider = options.provider || '';
    this.model = options.model || '';
    this.canFallback = Boolean(options.canFallback);
    this.partial = options.partial || null;
  }
}

function currentApiKey(provider) {
  const envName = provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'XFYUN_API_KEY';
  return process.env[envName] || '';
}

function privateUserId(userId) {
  const salt = process.env.AI_USER_ID_SALT || process.env.JWT_SECRET || 'liteoj-ai-user';
  return `liteoj_${crypto.createHmac('sha256', salt).update(String(userId)).digest('hex').slice(0, 32)}`;
}

function normalizeUsage(value = {}) {
  const inputTokens = Math.max(0, Number(value.prompt_tokens || value.input_tokens || value.inputTokens || 0));
  const outputTokens = Math.max(0, Number(value.completion_tokens || value.output_tokens || value.outputTokens || 0));
  const cacheHitTokens = Math.max(0, Number(value.prompt_cache_hit_tokens || value.cacheHitTokens || 0));
  const rawCacheMiss = value.prompt_cache_miss_tokens ?? value.cacheMissTokens;
  const hasCacheMiss = rawCacheMiss !== undefined && rawCacheMiss !== null;
  const cacheMissTokens = Math.max(0, Number(hasCacheMiss ? rawCacheMiss : Math.max(0, inputTokens - cacheHitTokens)));
  return {
    inputTokens,
    outputTokens,
    reasoningTokens: Math.max(0, Number(value.completion_tokens_details?.reasoning_tokens || value.reasoning_tokens || value.reasoningTokens || 0)),
    cacheHitTokens,
    cacheMissTokens,
  };
}

function estimatedDeepSeekCost(model, usage) {
  if (!String(model || '').startsWith('deepseek-v4-')) return 0;
  // CNY per million tokens from the DeepSeek pricing page, checked 2026-07-15.
  const rates = String(model).includes('pro')
    ? { hit: 0.025, miss: 3, output: 6 }
    : { hit: 0.02, miss: 1, output: 2 };
  return Number(((usage.cacheHitTokens * rates.hit
    + usage.cacheMissTokens * rates.miss
    + usage.outputTokens * rates.output) / 1000000).toFixed(8));
}

function linkedTimeoutSignal(parentSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) onParentAbort();
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('upstream timeout'));
  }, UPSTREAM_TIMEOUT_MS);
  timer.unref?.();
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

function requestBody({ settings, provider, model, messages, userId }) {
  const body = {
    model,
    messages,
    max_tokens: settings.maxOutputTokens,
    stream: true,
  };
  if (provider === 'deepseek') {
    body.thinking = { type: settings.deepseekThinkingEnabled ? 'enabled' : 'disabled' };
    if (settings.deepseekThinkingEnabled) body.reasoning_effort = 'high';
    body.stream_options = { include_usage: true };
    body.user_id = privateUserId(userId);
  } else {
    body.enable_thinking = false;
  }
  return body;
}

function friendlyHttpError(provider, model, status) {
  const options = { provider, model, httpStatus: status, canFallback: provider === 'deepseek' && [401, 402, 429].includes(status) };
  if (status === 401) return new AiProviderError('上游模型认证失败', { ...options, code: 'authentication_failed' });
  if (status === 402) return new AiProviderError('上游模型账户余额不足', { ...options, code: 'insufficient_balance' });
  if (status === 429) return new AiProviderError('上游模型请求过于繁忙', { ...options, code: 'rate_limited' });
  if (status === 400 || status === 422) return new AiProviderError('上游模型请求参数不兼容', { ...options, code: 'invalid_request', canFallback: false });
  if (status >= 500) return new AiProviderError('上游模型服务暂时不可用', { ...options, code: 'server_error', canFallback: provider === 'deepseek' });
  return new AiProviderError('上游模型请求失败', { ...options, code: `http_${status}`, canFallback: false });
}

async function collectOpenAiStream(response, onDelta, signal) {
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let usage = normalizeUsage();
  let finishReason = '';
  let responseModel = '';
  let done = false;

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload) return;
    if (payload === '[DONE]') {
      done = true;
      return;
    }
    let chunk;
    try { chunk = JSON.parse(payload); } catch (_) { return; }
    if (chunk.model) responseModel = String(chunk.model);
    if (chunk.usage) usage = normalizeUsage(chunk.usage);
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = String(choice.finish_reason);
    const delta = choice.delta?.content;
    if (typeof delta === 'string' && delta) {
      content += delta;
      onDelta?.(delta);
    }
  };

  try {
    for await (const chunk of response.body) {
      if (signal.aborted) throw signal.reason || new Error('aborted');
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      lines.forEach(handleLine);
      if (done) break;
    }
    buffer += decoder.decode();
    if (buffer) buffer.split(/\r?\n/).forEach(handleLine);
  } catch (err) {
    err.aiPartial = { content, usage, finishReason, model: responseModel };
    throw err;
  }
  return { content, usage, finishReason: finishReason || (done ? 'stop' : 'stream_interrupted'), model: responseModel };
}

async function streamCompletion({ settings, provider, model: modelOverride, messages, userId, signal, onDelta }) {
  const config = providerSettings(settings, provider, modelOverride);
  if (!currentApiKey(config.provider)) {
    throw new AiProviderError(`${config.label} API Key 未配置`, {
      provider: config.provider,
      model: config.model,
      code: 'missing_api_key',
      canFallback: config.provider === 'deepseek',
    });
  }

  const timeout = linkedTimeoutSignal(signal);
  try {
    let response;
    try {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: timeout.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentApiKey(config.provider)}`,
        },
        body: JSON.stringify(requestBody({ settings, provider: config.provider, model: config.model, messages, userId })),
      });
    } catch (err) {
      if (signal?.aborted) throw new AiProviderError('用户已中断生成', { provider: config.provider, model: config.model, code: 'client_aborted' });
      if (timeout.timedOut()) throw new AiProviderError('上游模型响应超时', { provider: config.provider, model: config.model, code: 'timeout', canFallback: config.provider === 'deepseek' });
      throw new AiProviderError('无法连接上游模型', { provider: config.provider, model: config.model, code: 'network_error', canFallback: config.provider === 'deepseek' });
    }
    if (!response.ok) {
      await response.text().catch(() => '');
      throw friendlyHttpError(config.provider, config.model, response.status);
    }
    try {
      const result = await collectOpenAiStream(response, onDelta, timeout.signal);
      return {
        ...result,
        provider: config.provider,
        providerLabel: config.label,
        model: result.model || config.model,
        estimatedCostCny: config.provider === 'deepseek' ? estimatedDeepSeekCost(config.model, result.usage) : 0,
      };
    } catch (err) {
      if (signal?.aborted) {
        throw new AiProviderError('用户已中断生成', {
          provider: config.provider,
          model: config.model,
          code: 'client_aborted',
          partial: err.aiPartial,
        });
      }
      if (timeout.timedOut()) {
        throw new AiProviderError('上游模型响应超时', {
          provider: config.provider,
          model: config.model,
          code: 'timeout',
          canFallback: config.provider === 'deepseek',
          partial: err.aiPartial,
        });
      }
      throw new AiProviderError('上游模型流式输出中断', {
        provider: config.provider,
        model: config.model,
        code: 'stream_interrupted',
        canFallback: config.provider === 'deepseek',
        partial: err.aiPartial,
      });
    }
  } finally {
    timeout.cleanup();
  }
}

module.exports = {
  AiProviderError,
  currentApiKey,
  estimatedDeepSeekCost,
  normalizeUsage,
  streamCompletion,
};
