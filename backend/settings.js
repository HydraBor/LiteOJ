const { LITEOJ_AI_SYSTEM_PROMPT, AI_REVIEW_PROMPT } = require('./ai-prompts');

const AI_PROVIDER_DEFAULTS = {
  xfyun: {
    label: '讯飞星辰',
    baseUrl: 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2',
    model: 'xopqwen36v35b',
    apiKeyEnv: 'XFYUN_API_KEY',
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
  },
};

const AI_SETTING_DEFAULTS = {
  'ai.enabled': '1',
  'ai.provider': 'xfyun',
  // Retained for compatibility with existing installations and API clients.
  'ai.base_url': AI_PROVIDER_DEFAULTS.xfyun.baseUrl,
  'ai.default_model': AI_PROVIDER_DEFAULTS.xfyun.model,
  'ai.xfyun_base_url': AI_PROVIDER_DEFAULTS.xfyun.baseUrl,
  'ai.xfyun_model': AI_PROVIDER_DEFAULTS.xfyun.model,
  'ai.deepseek_base_url': AI_PROVIDER_DEFAULTS.deepseek.baseUrl,
  'ai.deepseek_model': AI_PROVIDER_DEFAULTS.deepseek.model,
  'ai.deepseek_thinking_enabled': '0',
  'ai.fallback_to_xfyun': '1',
  'ai.max_requests_per_user_per_day': '30',
  'ai.max_input_chars': '12000',
  'ai.max_output_tokens': '2048',
  'ai.max_history_mb_per_user': '5',
  'ai.context_mode': 'recent',
  'ai.context_recent_messages': '6',
  'ai.system_prompt': LITEOJ_AI_SYSTEM_PROMPT,
  'ai.review_enabled': '1',
  'ai.review_provider': 'xfyun',
  'ai.review_model': AI_PROVIDER_DEFAULTS.xfyun.model,
  'ai.review_prompt': AI_REVIEW_PROMPT,
};

function intSetting(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function boolSetting(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function inputBool(value) {
  if (typeof value === 'boolean') return value;
  return boolSetting(value);
}

function cleanProvider(value, fallback = 'xfyun') {
  return AI_PROVIDER_DEFAULTS[value] ? value : fallback;
}

function cleanReviewProvider(value) {
  return value === 'same' ? 'same' : cleanProvider(value, 'xfyun');
}

function cleanBaseUrl(value, provider) {
  const fallback = AI_PROVIDER_DEFAULTS[provider]?.baseUrl || AI_PROVIDER_DEFAULTS.xfyun.baseUrl;
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (/^https:\/\//i.test(raw)) return raw;
  if (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(raw)) return raw;
  return fallback;
}

function settingRows(db, keys) {
  if (!keys.length) return new Map();
  const rows = db.prepare(`SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => '?').join(',')})`).all(...keys);
  return new Map(rows.map((row) => [row.key, row.value]));
}

function getSettings(db, defaults = AI_SETTING_DEFAULTS) {
  const keys = Object.keys(defaults);
  const rows = settingRows(db, keys);
  return Object.fromEntries(keys.map((key) => [key, rows.get(key) ?? defaults[key]]));
}

function providerSettings(settings, provider, modelOverride = '') {
  const selected = cleanProvider(provider, settings.provider || 'xfyun');
  const configured = settings.providers?.[selected] || AI_PROVIDER_DEFAULTS[selected];
  return {
    provider: selected,
    label: configured.label || AI_PROVIDER_DEFAULTS[selected].label,
    baseUrl: configured.baseUrl || AI_PROVIDER_DEFAULTS[selected].baseUrl,
    model: String(modelOverride || configured.model || AI_PROVIDER_DEFAULTS[selected].model).trim(),
    apiKeyEnv: configured.apiKeyEnv || AI_PROVIDER_DEFAULTS[selected].apiKeyEnv,
  };
}

function getAiSettings(db) {
  const raw = getSettings(db);
  const provider = cleanProvider(raw['ai.provider']);
  const providers = {
    xfyun: {
      ...AI_PROVIDER_DEFAULTS.xfyun,
      baseUrl: cleanBaseUrl(raw['ai.xfyun_base_url'], 'xfyun'),
      model: String(raw['ai.xfyun_model'] || AI_PROVIDER_DEFAULTS.xfyun.model).trim() || AI_PROVIDER_DEFAULTS.xfyun.model,
    },
    deepseek: {
      ...AI_PROVIDER_DEFAULTS.deepseek,
      baseUrl: cleanBaseUrl(raw['ai.deepseek_base_url'], 'deepseek'),
      model: String(raw['ai.deepseek_model'] || AI_PROVIDER_DEFAULTS.deepseek.model).trim() || AI_PROVIDER_DEFAULTS.deepseek.model,
    },
  };
  const active = providers[provider];
  const reviewProvider = cleanReviewProvider(raw['ai.review_provider']);
  const reviewResolvedProvider = reviewProvider === 'same' ? provider : reviewProvider;
  const reviewModel = reviewProvider === 'same'
    ? providers[reviewResolvedProvider].model
    : String(raw['ai.review_model'] || providers[reviewResolvedProvider].model).trim() || providers[reviewResolvedProvider].model;
  const maxHistoryMbPerUser = intSetting(raw['ai.max_history_mb_per_user'], 5, 1, 1024);
  return {
    enabled: boolSetting(raw['ai.enabled']),
    provider,
    providerLabel: active.label,
    baseUrl: active.baseUrl,
    apiKeyEnv: active.apiKeyEnv,
    defaultModel: active.model,
    providers,
    xfyunBaseUrl: providers.xfyun.baseUrl,
    xfyunModel: providers.xfyun.model,
    deepseekBaseUrl: providers.deepseek.baseUrl,
    deepseekModel: providers.deepseek.model,
    deepseekThinkingEnabled: boolSetting(raw['ai.deepseek_thinking_enabled']),
    fallbackToXfyun: boolSetting(raw['ai.fallback_to_xfyun']),
    maxRequestsPerUserPerDay: intSetting(raw['ai.max_requests_per_user_per_day'], 30, 1, 1000),
    maxInputChars: intSetting(raw['ai.max_input_chars'], 12000, 100, 100000),
    maxOutputTokens: intSetting(raw['ai.max_output_tokens'], 2048, 128, 32000),
    maxHistoryMbPerUser,
    historyLimitBytesPerUser: maxHistoryMbPerUser * 1024 * 1024,
    contextMode: raw['ai.context_mode'] === 'none' ? 'none' : 'recent',
    contextRecentMessages: intSetting(raw['ai.context_recent_messages'], 6, 0, 50),
    systemPrompt: String(raw['ai.system_prompt'] || LITEOJ_AI_SYSTEM_PROMPT).trim() || LITEOJ_AI_SYSTEM_PROMPT,
    reviewEnabled: boolSetting(raw['ai.review_enabled']),
    reviewProvider,
    reviewResolvedProvider,
    reviewProviderLabel: providers[reviewResolvedProvider].label,
    reviewModel,
    reviewApiKeyEnv: providers[reviewResolvedProvider].apiKeyEnv,
    reviewPrompt: String(raw['ai.review_prompt'] || AI_REVIEW_PROMPT).trim() || AI_REVIEW_PROMPT,
  };
}

function serializeAiSettings(input = {}) {
  const provider = cleanProvider(input.provider || input['ai.provider']);
  const legacyBaseUrl = input.baseUrl || input.base_url || input['ai.base_url'];
  const legacyModel = input.defaultModel || input.default_model || input['ai.default_model'];
  const xfyunBaseUrl = cleanBaseUrl(input.xfyunBaseUrl || input.xfyun_base_url || input['ai.xfyun_base_url'] || (provider === 'xfyun' ? legacyBaseUrl : ''), 'xfyun');
  const deepseekBaseUrl = cleanBaseUrl(input.deepseekBaseUrl || input.deepseek_base_url || input['ai.deepseek_base_url'] || (provider === 'deepseek' ? legacyBaseUrl : ''), 'deepseek');
  const xfyunModel = String(input.xfyunModel || input.xfyun_model || input['ai.xfyun_model'] || (provider === 'xfyun' ? legacyModel : '') || AI_PROVIDER_DEFAULTS.xfyun.model).trim() || AI_PROVIDER_DEFAULTS.xfyun.model;
  const deepseekModel = String(input.deepseekModel || input.deepseek_model || input['ai.deepseek_model'] || (provider === 'deepseek' ? legacyModel : '') || AI_PROVIDER_DEFAULTS.deepseek.model).trim() || AI_PROVIDER_DEFAULTS.deepseek.model;
  const activeBaseUrl = provider === 'deepseek' ? deepseekBaseUrl : xfyunBaseUrl;
  const activeModel = provider === 'deepseek' ? deepseekModel : xfyunModel;
  const reviewProvider = cleanReviewProvider(input.reviewProvider || input.review_provider || input['ai.review_provider']);
  const reviewDefaultProvider = reviewProvider === 'same' ? provider : reviewProvider;
  const reviewModel = reviewProvider === 'same'
    ? activeModel
    : String(input.reviewModel || input.review_model || input['ai.review_model'] || (reviewDefaultProvider === 'deepseek' ? deepseekModel : xfyunModel)).trim();
  const contextMode = input.contextMode || input.context_mode || input['ai.context_mode'];
  return {
    'ai.enabled': inputBool(input.enabled ?? input['ai.enabled']) ? '1' : '0',
    'ai.provider': provider,
    'ai.base_url': activeBaseUrl,
    'ai.default_model': activeModel,
    'ai.xfyun_base_url': xfyunBaseUrl,
    'ai.xfyun_model': xfyunModel,
    'ai.deepseek_base_url': deepseekBaseUrl,
    'ai.deepseek_model': deepseekModel,
    'ai.deepseek_thinking_enabled': inputBool(input.deepseekThinkingEnabled ?? input.deepseek_thinking_enabled ?? input['ai.deepseek_thinking_enabled']) ? '1' : '0',
    'ai.fallback_to_xfyun': inputBool(input.fallbackToXfyun ?? input.fallback_to_xfyun ?? input['ai.fallback_to_xfyun']) ? '1' : '0',
    'ai.max_requests_per_user_per_day': String(intSetting(input.maxRequestsPerUserPerDay ?? input.max_requests_per_user_per_day ?? input['ai.max_requests_per_user_per_day'], 30, 1, 1000)),
    'ai.max_input_chars': String(intSetting(input.maxInputChars ?? input.max_input_chars ?? input['ai.max_input_chars'], 12000, 100, 100000)),
    'ai.max_output_tokens': String(intSetting(input.maxOutputTokens ?? input.max_output_tokens ?? input['ai.max_output_tokens'], 2048, 128, 32000)),
    'ai.max_history_mb_per_user': String(intSetting(input.maxHistoryMbPerUser ?? input.max_history_mb_per_user ?? input['ai.max_history_mb_per_user'], 5, 1, 1024)),
    'ai.context_mode': contextMode === 'none' ? 'none' : 'recent',
    'ai.context_recent_messages': String(intSetting(input.contextRecentMessages ?? input.context_recent_messages ?? input['ai.context_recent_messages'], 6, 0, 50)),
    'ai.system_prompt': String(input.systemPrompt || input.system_prompt || input['ai.system_prompt'] || LITEOJ_AI_SYSTEM_PROMPT).trim() || LITEOJ_AI_SYSTEM_PROMPT,
    'ai.review_enabled': inputBool(input.reviewEnabled ?? input.review_enabled ?? input['ai.review_enabled']) ? '1' : '0',
    'ai.review_provider': reviewProvider,
    'ai.review_model': reviewModel,
    'ai.review_prompt': String(input.reviewPrompt || input.review_prompt || input['ai.review_prompt'] || AI_REVIEW_PROMPT).trim() || AI_REVIEW_PROMPT,
  };
}

function saveAiSettings(db, input = {}) {
  const values = serializeAiSettings(input);
  const upsert = db.prepare(`INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`);
  db.transaction(() => Object.entries(values).forEach(([key, value]) => upsert.run(key, value)))();
  return getAiSettings(db);
}

module.exports = {
  AI_SETTING_DEFAULTS,
  AI_PROVIDER_DEFAULTS,
  getSettings,
  getAiSettings,
  saveAiSettings,
  providerSettings,
};
