const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, migrate, DATA_DIR } = require('../backend/db');
const { parsePaperQuestions } = require('../backend/prelim-utils');
const { importParsedPaper } = require('../backend/routes/prelim');

migrate();


function copyDirIfNeeded(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    const stat = fs.statSync(s);
    if (stat.isDirectory()) {
      copyDirIfNeeded(s, d);
    } else if (!fs.existsSync(d)) {
      fs.copyFileSync(s, d);
    }
  }
}

function copySeedProblems() {
  const seedDir = path.join(__dirname, '..', 'seed', 'problems');
  const destDir = path.join(DATA_DIR, 'problems');
  if (fs.existsSync(seedDir)) copyDirIfNeeded(seedDir, destDir);
}


function seedPrelimPapers() {
  const seedDir = path.join(__dirname, '..', 'seed', 'prelim');
  if (!fs.existsSync(seedDir)) return;
  const files = fs.readdirSync(seedDir).filter((name) => name.endsWith('.md') && !name.includes('solution') && !name.includes('答案'));
  for (const name of files) {
    const base = name.replace(/\.md$/i, '');
    const paperPath = path.join(seedDir, name);
    const solutionCandidates = [
      path.join(seedDir, `${base}-solution.md`),
      path.join(seedDir, `${base}_solution.md`),
      path.join(seedDir, `${base}_答案详解.md`),
    ];
    const solutionPath = solutionCandidates.find((x) => fs.existsSync(x));
    if (!solutionPath) continue;
    const metaMatch = base.match(/^(\d{4})-CSP-([JS])1?$/i) || base.match(/^(\d{4}).*CSP[-_ ]?([JS])/i);
    const year = metaMatch ? Number(metaMatch[1]) : 2025;
    const groupName = metaMatch ? `CSP-${metaMatch[2].toUpperCase()}` : 'CSP-J';
    const roundName = '初赛';
    const exists = db.prepare('SELECT id FROM prelim_papers WHERE year = ? AND group_name = ? AND round_name = ?').get(year, groupName, roundName);
    if (exists) continue;
    const parsed = parsePaperQuestions(fs.readFileSync(paperPath, 'utf8'), fs.readFileSync(solutionPath, 'utf8'), {
      year,
      groupName,
      roundName,
      title: `${year} ${groupName} 初赛真题`,
      totalScore: 100,
    });
    const paperId = importParsedPaper(parsed, { replace: false });
    console.log(`Imported prelim seed paper #${paperId}: ${parsed.paper.title} (${parsed.groups.length} items / ${parsed.questions.length} questions)`);
  }
}


function seedAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, bcrypt.hashSync(password, 10), 'admin');
  console.log(`Created default admin: ${username} / ${password}`);
}

function seedProblem(problemDir) {
  const problemPath = path.join(problemDir, 'problem.json');
  if (!fs.existsSync(problemPath)) return;
  const raw = JSON.parse(fs.readFileSync(problemPath, 'utf8'));
  const exists = db.prepare('SELECT id, title, description, tags_json FROM problems WHERE id = ?').get(raw.id);
  if (!exists) {
    db.prepare(`INSERT INTO problems
      (id, title, description, tags_json, difficulty, time_limit, memory_limit, is_public, created_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`).run(
      raw.id,
      raw.title,
      raw.description || '',
      JSON.stringify(raw.tags || []),
      raw.difficulty || 'beginner',
      Number(raw.timeLimit) || 1000,
      Number(raw.memoryLimit) || 128,
      raw.isPublic === 0 ? 0 : 1,
    );
  } else if (raw.id === 'P1001') {
    const existingDescription = String(exists.description || '');
    const existingTags = String(exists.tags_json || '[]');
    const shouldRefreshSample =
      existingDescription.includes('数学公式示例') ||
      existingDescription.includes('a^2+b^2') ||
      !existingDescription.includes('$a+b$') ||
      existingTags !== JSON.stringify(['模拟']);
    if (shouldRefreshSample) {
      db.prepare('UPDATE problems SET title = ?, description = ?, tags_json = ?, difficulty = ?, time_limit = ?, memory_limit = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        raw.title,
        raw.description || '',
        JSON.stringify(raw.tags || []),
        raw.difficulty || 'beginner',
        Number(raw.timeLimit) || 1000,
        Number(raw.memoryLimit) || 128,
        raw.isPublic === 0 ? 0 : 1,
        raw.id,
      );
    }
  }
  const caseCount = db.prepare('SELECT COUNT(*) AS c FROM problem_cases WHERE problem_id = ?').get(raw.id).c;
  if (caseCount === 0 && Array.isArray(raw.cases)) {
    const insert = db.prepare('INSERT INTO problem_cases (problem_id, input_path, output_path, score, sort) VALUES (?, ?, ?, ?, ?)');
    raw.cases.forEach((c, idx) => insert.run(raw.id, c.inputPath, c.outputPath, Number(c.score) || 0, Number(c.sort) || idx + 1));
  }
}

function seedProblems() {
  const problemsDir = path.join(DATA_DIR, 'problems');
  if (!fs.existsSync(problemsDir)) return;
  for (const name of fs.readdirSync(problemsDir)) {
    const dir = path.join(problemsDir, name);
    if (fs.statSync(dir).isDirectory()) seedProblem(dir);
  }
}

seedAdmin();
copySeedProblems();
seedProblems();
seedPrelimPapers();
console.log(`Database initialized at ${process.env.DATABASE_PATH || path.join(DATA_DIR, 'liteoj.db')}`);
