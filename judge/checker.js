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

module.exports = { standardCheck, normalizeOutput };
