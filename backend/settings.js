const { LITEOJ_AI_SYSTEM_PROMPT } = require('./ai-prompts');

const AI_SETTING_DEFAULTS = {
  'ai.enabled': '1',
  'ai.provider': 'xfyun',
  'ai.base_url': 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2',
  'ai.default_model': 'xopqwen36v35b',
  'ai.max_requests_per_user_per_day': '30',
  'ai.max_input_chars': '12000',
  'ai.max_output_tokens': '2048',
  'ai.context_mode': 'recent',
  'ai.context_recent_messages': '6',
  'ai.system_prompt': LITEOJ_AI_SYSTEM_PROMPT,
  'ai.block_full_code': '1',
  'ai.max_code_block_lines': '12',
  'ai.direct_refusal_enabled': '1',
};

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

function cleanProvider(value) {
  return AI_PROVIDER_DEFAULTS[value] ? value : 'xfyun';
}

function cleanBaseUrl(value, provider) {
  const fallback = AI_PROVIDER_DEFAULTS[provider]?.baseUrl || AI_SETTING_DEFAULTS['ai.base_url'];
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(raw)) return fallback;
  return raw;
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

function getAiSettings(db) {
  const raw = getSettings(db);
  const provider = cleanProvider(raw['ai.provider']);
  const providerDefaults = AI_PROVIDER_DEFAULTS[provider];
  return {
    enabled: boolSetting(raw['ai.enabled']),
    provider,
    providerLabel: providerDefaults.label,
    baseUrl: cleanBaseUrl(raw['ai.base_url'], provider),
    apiKeyEnv: providerDefaults.apiKeyEnv,
    defaultModel: String(raw['ai.default_model'] || providerDefaults.model).trim() || providerDefaults.model,
    maxRequestsPerUserPerDay: intSetting(raw['ai.max_requests_per_user_per_day'], 30, 1, 1000),
    maxInputChars: intSetting(raw['ai.max_input_chars'], 12000, 100, 100000),
    maxOutputTokens: intSetting(raw['ai.max_output_tokens'], 2048, 128, 32000),
    contextMode: raw['ai.context_mode'] === 'none' ? 'none' : 'recent',
    contextRecentMessages: intSetting(raw['ai.context_recent_messages'], 6, 0, 50),
    systemPrompt: String(raw['ai.system_prompt'] || LITEOJ_AI_SYSTEM_PROMPT).trim() || LITEOJ_AI_SYSTEM_PROMPT,
    blockFullCode: boolSetting(raw['ai.block_full_code']),
    maxCodeBlockLines: intSetting(raw['ai.max_code_block_lines'], 12, 1, 100),
    directRefusalEnabled: boolSetting(raw['ai.direct_refusal_enabled']),
  };
}

function serializeAiSettings(input = {}) {
  const provider = cleanProvider(input.provider || input['ai.provider']);
  const providerDefaults = AI_PROVIDER_DEFAULTS[provider];
  const contextMode = input.contextMode || input.context_mode || input['ai.context_mode'];
  const enabledValue = input.enabled ?? input['ai.enabled'];
  return {
    'ai.enabled': inputBool(enabledValue) ? '1' : '0',
    'ai.provider': provider,
    'ai.base_url': cleanBaseUrl(input.baseUrl || input.base_url || input['ai.base_url'] || providerDefaults.baseUrl, provider),
    'ai.default_model': String(input.defaultModel || input.default_model || input['ai.default_model'] || providerDefaults.model).trim() || providerDefaults.model,
    'ai.max_requests_per_user_per_day': String(intSetting(input.maxRequestsPerUserPerDay ?? input.max_requests_per_user_per_day ?? input['ai.max_requests_per_user_per_day'], 30, 1, 1000)),
    'ai.max_input_chars': String(intSetting(input.maxInputChars ?? input.max_input_chars ?? input['ai.max_input_chars'], 12000, 100, 100000)),
    'ai.max_output_tokens': String(intSetting(input.maxOutputTokens ?? input.max_output_tokens ?? input['ai.max_output_tokens'], 2048, 128, 32000)),
    'ai.context_mode': contextMode === 'none' ? 'none' : 'recent',
    'ai.context_recent_messages': String(intSetting(input.contextRecentMessages ?? input.context_recent_messages ?? input['ai.context_recent_messages'], 6, 0, 50)),
    'ai.system_prompt': String(input.systemPrompt || input.system_prompt || input['ai.system_prompt'] || LITEOJ_AI_SYSTEM_PROMPT).trim() || LITEOJ_AI_SYSTEM_PROMPT,
    'ai.block_full_code': inputBool(input.blockFullCode ?? input.block_full_code ?? input['ai.block_full_code']) ? '1' : '0',
    'ai.max_code_block_lines': String(intSetting(input.maxCodeBlockLines ?? input.max_code_block_lines ?? input['ai.max_code_block_lines'], 12, 1, 100)),
    'ai.direct_refusal_enabled': inputBool(input.directRefusalEnabled ?? input.direct_refusal_enabled ?? input['ai.direct_refusal_enabled']) ? '1' : '0',
  };
}

function saveAiSettings(db, input = {}) {
  const values = serializeAiSettings(input);
  const upsert = db.prepare(`INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`);
  const tx = db.transaction(() => {
    Object.entries(values).forEach(([key, value]) => upsert.run(key, value));
  });
  tx();
  return getAiSettings(db);
}

module.exports = {
  AI_SETTING_DEFAULTS,
  AI_PROVIDER_DEFAULTS,
  getSettings,
  getAiSettings,
  saveAiSettings,
};
