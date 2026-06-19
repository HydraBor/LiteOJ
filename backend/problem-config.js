const CHECKER_MODES = new Set(['standard', 'special_judge', 'ignore_space', 'case_insensitive', 'float']);

function boolToInt(value) {
  return value ? 1 : 0;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'on', 'yes'].includes(String(value).toLowerCase());
}

function normalizeCheckerMode(value, fallback = 'standard') {
  const mode = String(value || fallback).trim();
  return CHECKER_MODES.has(mode) ? mode : fallback;
}

function normalizeCheckerTolerance(value, fallback = 0.000001) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 1);
}

module.exports = {
  CHECKER_MODES,
  boolToInt,
  parseBoolean,
  normalizeCheckerMode,
  normalizeCheckerTolerance,
};
