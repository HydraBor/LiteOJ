const DIFFICULTY_RANK = {
  unrated: 0,
  beginner: 1,
  popular_minus: 2,
  improve_minus: 3,
  popular_plus: 4,
  province_minus: 5,
  noi_minus: 6,
  ctsc: 7,
};

const PROBLEM_ID_PATTERN = /^[A-Z]+\d+$/;

function normalizeDifficulty(value) {
  const raw = String(value || 'unrated');
  return Object.prototype.hasOwnProperty.call(DIFFICULTY_RANK, raw) ? raw : 'unrated';
}

function parseProblemCode(value, options = {}) {
  const raw = String(value ?? '').trim();
  if (!raw && options.allowEmpty) return null;
  if (!PROBLEM_ID_PATTERN.test(raw)) return null;
  return raw;
}

function requireProblemCode(value, field = '题号') {
  const id = parseProblemCode(value);
  if (!id) {
    const err = new Error(`${field}格式错误：题号必须由若干大写英文字母 + 若干数字组成，例如 P1001、ABC12`);
    err.status = 400;
    throw err;
  }
  return id;
}

function splitProblemCode(value) {
  const m = String(value || '').match(/^([A-Z]+)(\d+)$/);
  if (!m) return { prefix: String(value || ''), number: 0, raw: String(value || '') };
  return { prefix: m[1], number: Number(m[2]), raw: String(value || '') };
}

function compareProblemCode(a, b) {
  const x = splitProblemCode(a);
  const y = splitProblemCode(b);
  const prefix = x.prefix.localeCompare(y.prefix, 'en');
  if (prefix !== 0) return prefix;
  if (x.number !== y.number) return x.number - y.number;
  return x.raw.localeCompare(y.raw, 'en');
}

function compareNatural(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
}

function sortProblems(list, strategy = 'default') {
  const arr = [...list];
  if (strategy === 'recent') {
    return arr.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || compareProblemCode(a.id, b.id));
  }
  if (strategy === 'title') {
    return arr.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN') || compareProblemCode(a.id, b.id));
  }
  if (strategy === 'difficulty') {
    return arr.sort((a, b) => (DIFFICULTY_RANK[normalizeDifficulty(a.difficulty)] ?? 0) - (DIFFICULTY_RANK[normalizeDifficulty(b.difficulty)] ?? 0) || compareProblemCode(a.id, b.id));
  }
  if (strategy === 'acceptance') {
    return arr.sort((a, b) => {
      const ar = a.submitCount ? a.acCount / a.submitCount : -1;
      const br = b.submitCount ? b.acCount / b.submitCount : -1;
      return br - ar || compareProblemCode(a.id, b.id);
    });
  }
  return arr.sort((a, b) => compareProblemCode(a.id, b.id));
}

module.exports = {
  DIFFICULTY_RANK,
  PROBLEM_ID_PATTERN,
  normalizeDifficulty,
  parseProblemCode,
  requireProblemCode,
  splitProblemCode,
  compareProblemCode,
  compareNatural,
  sortProblems,
};
