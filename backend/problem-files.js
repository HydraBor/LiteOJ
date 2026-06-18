const fs = require('fs');
const path = require('path');
const { DATA_DIR, caseFromRow } = require('./db');

function sanitizeDataFileName(filename) {
  const raw = String(filename || '').replace(/\\/g, '/').split('/').filter(Boolean).join('_');
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || `file_${Date.now()}`;
}

function sanitizeSubtaskName(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim().replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_'))
    .filter(Boolean)
    .join('/')
    .slice(0, 80);
}

function problemRoot(problemId) {
  return path.join(DATA_DIR, 'problems', `${problemId}`);
}

function ensureProblemDir(problemId) {
  const dir = path.join(problemRoot(problemId), 'testdata');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function attachmentDir(problemId) {
  const dir = path.join(problemRoot(problemId), 'attachments');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeAttachmentFileName(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  const base = path.basename(String(filename || 'image'), ext).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '') || 'image';
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${base}${ext}`;
}

function copyAttachmentsAndRewriteDescription(fromId, toId, description) {
  const fromDir = path.join(problemRoot(fromId), 'attachments');
  const toDir = attachmentDir(toId);
  if (fs.existsSync(fromDir)) {
    for (const name of fs.readdirSync(fromDir)) {
      const src = path.join(fromDir, name);
      const dest = path.join(toDir, name);
      if (fs.statSync(src).isFile()) fs.copyFileSync(src, dest);
    }
  }
  const fromPrefix = `/api/problems/${encodeURIComponent(fromId)}/attachments/`;
  const toPrefix = `/api/problems/${encodeURIComponent(toId)}/attachments/`;
  return String(description || '').split(fromPrefix).join(toPrefix);
}

function caseRelativePath(problemId, file) {
  return path.join('problems', `${problemId}`, 'testdata', file).replace(/\\/g, '/');
}

function absoluteDataPath(relativePath) {
  const full = path.resolve(DATA_DIR, relativePath);
  const base = path.resolve(DATA_DIR);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw Object.assign(new Error('非法文件路径'), { status: 400 });
  }
  return full;
}

function readCaseContent(row) {
  const c = caseFromRow(row);
  const inputPath = absoluteDataPath(row.input_path);
  const outputPath = absoluteDataPath(row.output_path);
  c.input = fs.existsSync(inputPath) ? fs.readFileSync(inputPath, 'utf8') : '';
  c.output = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
  return c;
}

module.exports = {
  sanitizeDataFileName,
  sanitizeSubtaskName,
  problemRoot,
  ensureProblemDir,
  attachmentDir,
  sanitizeAttachmentFileName,
  copyAttachmentsAndRewriteDescription,
  caseRelativePath,
  absoluteDataPath,
  readCaseContent,
};
