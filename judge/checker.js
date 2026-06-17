function normalizeOutput(value) {
  return String(value)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function standardCheck(actual, expected) {
  return normalizeOutput(actual) === normalizeOutput(expected);
}

function tokenizeOutput(value) {
  const normalized = normalizeOutput(value);
  return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

function ignoreWhitespaceCheck(actual, expected) {
  const a = tokenizeOutput(actual);
  const e = tokenizeOutput(expected);
  return a.length === e.length && a.every((token, i) => token === e[i]);
}

function caseInsensitiveCheck(actual, expected) {
  return normalizeOutput(actual).toLowerCase() === normalizeOutput(expected).toLowerCase();
}

function isNumericToken(value) {
  return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(String(value || ''));
}

function floatCheck(actual, expected, tolerance = 0.000001) {
  const a = tokenizeOutput(actual);
  const e = tokenizeOutput(expected);
  if (a.length !== e.length) return false;
  const eps = Math.max(Number(tolerance) || 0.000001, 0);
  for (let i = 0; i < e.length; i += 1) {
    if (isNumericToken(a[i]) && isNumericToken(e[i])) {
      const av = Number(a[i]);
      const ev = Number(e[i]);
      const allowed = eps * Math.max(1, Math.abs(ev));
      if (Math.abs(av - ev) > allowed) return false;
    } else if (a[i] !== e[i]) {
      return false;
    }
  }
  return true;
}

function compareOutput(actual, expected, options = {}) {
  const mode = String(options.mode || 'standard');
  if (mode === 'ignore_space') return ignoreWhitespaceCheck(actual, expected);
  if (mode === 'case_insensitive') return caseInsensitiveCheck(actual, expected);
  if (mode === 'float') return floatCheck(actual, expected, options.tolerance);
  return standardCheck(actual, expected);
}

module.exports = {
  standardCheck,
  normalizeOutput,
  tokenizeOutput,
  ignoreWhitespaceCheck,
  caseInsensitiveCheck,
  floatCheck,
  compareOutput,
};
