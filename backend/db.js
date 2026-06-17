const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'liteoj.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DATABASE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS problems (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      difficulty TEXT NOT NULL DEFAULT 'unrated',
      time_limit INTEGER NOT NULL DEFAULT 1000,
      memory_limit INTEGER NOT NULL DEFAULT 128,
      is_public INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS problem_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id TEXT NOT NULL,
      input_path TEXT NOT NULL,
      output_path TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(problem_id) REFERENCES problems(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      problem_id TEXT NOT NULL,
      language TEXT NOT NULL,
      code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Waiting',
      score INTEGER NOT NULL DEFAULT 0,
      time_ms INTEGER NOT NULL DEFAULT 0,
      memory_kb INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      details_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      locked_at TEXT,
      judge_id TEXT,
      optimize INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(problem_id) REFERENCES problems(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_submissions_problem ON submissions(problem_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
    CREATE INDEX IF NOT EXISTS idx_problems_public ON problems(is_public);
    CREATE INDEX IF NOT EXISTS idx_problems_title ON problems(title);

    CREATE TABLE IF NOT EXISTS prelim_papers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      group_name TEXT NOT NULL,
      round_name TEXT NOT NULL DEFAULT '初赛',
      title TEXT NOT NULL,
      total_score REAL NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(year, group_name, round_name)
    );

    CREATE TABLE IF NOT EXISTS prelim_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER NOT NULL,
      number INTEGER NOT NULL,
      section TEXT NOT NULL,
      group_no TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      section_title TEXT NOT NULL DEFAULT '',
      stem TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      is_public INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(paper_id) REFERENCES prelim_papers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS prelim_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      paper_id INTEGER NOT NULL,
      number INTEGER NOT NULL,
      question_type TEXT NOT NULL,
      stem TEXT NOT NULL DEFAULT '',
      score REAL NOT NULL DEFAULT 0,
      options_json TEXT NOT NULL DEFAULT '[]',
      answer TEXT NOT NULL DEFAULT '',
      explanation TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(group_id) REFERENCES prelim_groups(id) ON DELETE CASCADE,
      FOREIGN KEY(paper_id) REFERENCES prelim_papers(id) ON DELETE CASCADE,
      UNIQUE(paper_id, number)
    );

    CREATE TABLE IF NOT EXISTS prelim_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      question_id INTEGER NOT NULL,
      selected_answer TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(question_id) REFERENCES prelim_questions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS prelim_mock_exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      title TEXT NOT NULL,
      year INTEGER,
      group_name TEXT NOT NULL DEFAULT 'CSP-J',
      source_paper_id INTEGER,
      group_ids_json TEXT NOT NULL DEFAULT '[]',
      answers_json TEXT NOT NULL DEFAULT '{}',
      score REAL NOT NULL DEFAULT 0,
      total_score REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      submitted_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(source_paper_id) REFERENCES prelim_papers(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_prelim_groups_paper ON prelim_groups(paper_id);
    CREATE INDEX IF NOT EXISTS idx_prelim_groups_meta ON prelim_groups(section, is_public);
    CREATE INDEX IF NOT EXISTS idx_prelim_questions_group ON prelim_questions(group_id);
    CREATE INDEX IF NOT EXISTS idx_prelim_questions_paper ON prelim_questions(paper_id);
    CREATE INDEX IF NOT EXISTS idx_prelim_questions_meta ON prelim_questions(question_type);
    CREATE INDEX IF NOT EXISTS idx_prelim_attempts_question ON prelim_attempts(question_id);
    CREATE INDEX IF NOT EXISTS idx_prelim_attempts_user ON prelim_attempts(user_id);
    CREATE INDEX IF NOT EXISTS idx_prelim_mock_user ON prelim_mock_exams(user_id);
    CREATE INDEX IF NOT EXISTS idx_prelim_mock_paper ON prelim_mock_exams(source_paper_id);
  `);

  function tableColumns(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map((x) => x.name);
  }
  function ensureColumn(table, column, definition) {
    const cols = tableColumns(table);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  // Keep initialization safe when the user updates without deleting data/liteoj.db.
  // These migrations are additive and preserve existing local databases.
  ensureColumn('problems', 'description', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('problems', 'tags_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn('problems', 'difficulty', "TEXT NOT NULL DEFAULT 'unrated'");
  ensureColumn('problems', 'time_limit', 'INTEGER NOT NULL DEFAULT 1000');
  ensureColumn('problems', 'memory_limit', 'INTEGER NOT NULL DEFAULT 128');
  ensureColumn('problems', 'is_public', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('problems', 'created_by', 'INTEGER');
  ensureColumn('problems', 'created_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('problems', 'updated_at', "TEXT NOT NULL DEFAULT ''");

  ensureColumn('problem_cases', 'input_path', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('problem_cases', 'output_path', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('problem_cases', 'score', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('problem_cases', 'sort', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('problem_cases', 'created_at', "TEXT NOT NULL DEFAULT ''");

  ensureColumn('submissions', 'details_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn('submissions', 'time_ms', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('submissions', 'memory_kb', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('submissions', 'message', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('submissions', 'updated_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('submissions', 'locked_at', 'TEXT');
  ensureColumn('submissions', 'judge_id', 'TEXT');
  ensureColumn('submissions', 'optimize', 'INTEGER NOT NULL DEFAULT 1');

  ensureColumn('prelim_groups', 'section_title', "TEXT NOT NULL DEFAULT ''");

}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch (_) { return fallback; }
}

function problemFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    tags: parseJson(row.tags_json, []),
    difficulty: row.difficulty || 'unrated',
    timeLimit: row.time_limit,
    memoryLimit: row.memory_limit,
    isPublic: Boolean(row.is_public),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function caseFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    problemId: row.problem_id,
    inputPath: row.input_path,
    outputPath: row.output_path,
    score: row.score,
    sort: row.sort,
    createdAt: row.created_at,
  };
}

function submissionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    problemId: row.problem_id,
    language: row.language,
    optimize: Boolean(row.optimize),
    code: row.code,
    status: row.status,
    score: row.score,
    timeMs: row.time_ms,
    memoryKb: row.memory_kb,
    message: row.message,
    details: parseJson(row.details_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lockedAt: row.locked_at,
    judgeId: row.judge_id,
    username: row.username,
    problemTitle: row.problem_title,
  };
}

module.exports = {
  db,
  migrate,
  DATA_DIR,
  DATABASE_PATH,
  problemFromRow,
  caseFromRow,
  submissionFromRow,
  parseJson,
};
