const schema = require('../seed/tag-schema.json');

const SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const seedTags = Array.isArray(schema.tags) ? schema.tags : [];
const seedTagMap = new Map(seedTags.map((tag) => [tag.slug, tag]));

function cleanSlug(value) {
  const raw = String(value || '').trim().replace(/^`|`$/g, '').toLowerCase();
  return SLUG_RE.test(raw) ? raw : '';
}

function sourceValue(input) {
  if (input === null || input === undefined) return '';
  if (typeof input === 'string') return input;
  return input.slug || input.tagSlug || input.value || '';
}

function canonicalFromSeed(slug, extra = {}) {
  const tag = seedTagMap.get(slug);
  if (!tag) return null;
  return {
    slug: tag.slug,
    name: tag.nameZh,
    nameZh: tag.nameZh,
    weight: extra.weight ?? 0,
    isPrimary: Boolean(extra.isPrimary),
    nodeType: tag.nodeType || 'knowledge',
    level: tag.level || 'topic',
    parentSlug: tag.parentSlug || '',
    scope: tag.scope || 'all',
  };
}

function resolveSeedTag(value) {
  const slug = cleanSlug(value);
  return slug ? seedTagMap.get(slug) || null : null;
}

function weightOf(input, fallback = 0) {
  const value = Number(input?.weight ?? input?.scoreWeight ?? fallback);
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function tagInputLabel(input) {
  if (typeof input === 'string') return input;
  if (!input) return '';
  return input.slug || input.tagSlug || input.value || input.nameZh || input.name || input.label || '';
}

function unknownTagError(values) {
  const list = [...new Set(values.map((x) => String(x || '').trim()).filter(Boolean))];
  const err = new Error(`未知标签 slug：${list.join('、') || '空标签'}`);
  err.status = 400;
  return err;
}

function normalizeTagInput(input, options = {}) {
  if (input === null || input === undefined) return null;
  const slug = cleanSlug(sourceValue(input));
  const found = slug ? resolveSeedTag(slug) : null;
  if (!found) return null;
  return canonicalFromSeed(found.slug, {
    weight: typeof input === 'string' ? (options.defaultWeight || 0) : weightOf(input, options.defaultWeight || 0),
    isPrimary: typeof input === 'string' ? false : input.isPrimary,
  });
}

function normalizeTagList(tags, options = {}) {
  const source = Array.isArray(tags) ? tags : [];
  const map = new Map();
  const invalid = [];
  source.forEach((tag, index) => {
    const normalized = normalizeTagInput(tag, options);
    if (!normalized) {
      const label = tagInputLabel(tag);
      if (label) invalid.push(label);
      return;
    }
    if (!normalized.weight && options.problemMode) normalized.weight = index === 0 ? 10 : 7;
    normalized.isPrimary = Boolean(normalized.isPrimary || (options.problemMode && index === 0));
    const existing = map.get(normalized.slug);
    if (!existing) {
      map.set(normalized.slug, normalized);
      return;
    }
    existing.weight = Math.max(Number(existing.weight) || 0, Number(normalized.weight) || 0);
    existing.isPrimary = existing.isPrimary || normalized.isPrimary;
  });
  if (options.throwOnUnknown && invalid.length) throw unknownTagError(invalid);
  return [...map.values()].map((tag) => ({
    slug: tag.slug,
    name: tag.nameZh || tag.name || tag.slug,
    nameZh: tag.nameZh || tag.name || tag.slug,
    weight: Number(tag.weight) || 0,
    isPrimary: Boolean(tag.isPrimary),
  }));
}

function tagDisplayName(tag) {
  if (!tag) return '';
  if (typeof tag === 'string') {
    const found = resolveSeedTag(tag);
    return found ? found.nameZh : tag;
  }
  return tag.nameZh || tag.name || tag.label || tag.slug || '';
}

function tagSlug(tag) {
  if (!tag) return '';
  const slug = typeof tag === 'string' ? cleanSlug(tag) : cleanSlug(tag.slug || tag.tagSlug || tag.value || '');
  return seedTagMap.has(slug) ? slug : '';
}

function tagNamesFromList(tags) {
  return (Array.isArray(tags) ? tags : []).map(tagDisplayName).filter(Boolean);
}

function seedTagDictionary(db) {
  const upsertTag = db.prepare(`INSERT INTO oj_tags
    (slug, name_zh, name_en, parent_slug, level, node_type, scope, description, sort_order, is_visible, is_deprecated, merged_to_slug, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, '', CURRENT_TIMESTAMP)
    ON CONFLICT(slug) DO UPDATE SET
      name_zh = excluded.name_zh,
      name_en = excluded.name_en,
      parent_slug = excluded.parent_slug,
      level = excluded.level,
      node_type = excluded.node_type,
      scope = excluded.scope,
      description = excluded.description,
      sort_order = excluded.sort_order,
      is_visible = 1,
      is_deprecated = 0,
      merged_to_slug = '',
      updated_at = CURRENT_TIMESTAMP`);
  const tx = db.transaction(() => {
    for (const tag of seedTags) {
      upsertTag.run(
        tag.slug,
        tag.nameZh,
        tag.nameEn || '',
        tag.parentSlug || '',
        tag.level || 'topic',
        tag.nodeType || 'knowledge',
        tag.scope || 'all',
        tag.description || '',
        Number(tag.sortOrder) || 0,
      );
    }
    if (seedTags.length) {
      const placeholders = seedTags.map(() => '?').join(',');
      db.prepare(`UPDATE oj_tags
        SET is_visible = 0, is_deprecated = 1, updated_at = CURRENT_TIMESTAMP
        WHERE slug NOT IN (${placeholders})`).run(...seedTags.map((tag) => tag.slug));
    }
  });
  tx();
}

function syncProblemTags(db, problemId, tags, source = 'manual') {
  const normalized = normalizeTagList(tags, { problemMode: true });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM oj_problem_tags WHERE problem_id = ?').run(problemId);
    const insert = db.prepare(`INSERT INTO oj_problem_tags (problem_id, tag_slug, weight, is_primary, source)
      VALUES (?, ?, ?, ?, ?)`);
    normalized.forEach((tag, index) => insert.run(problemId, tag.slug, Number(tag.weight) || (index === 0 ? 10 : 7), tag.isPrimary ? 1 : 0, source));
  });
  tx();
  return normalized;
}

function syncPrelimQuestionTags(db, questionId, tags, source = 'imported') {
  const normalized = normalizeTagList(tags);
  const maxWeight = normalized.reduce((max, tag) => Math.max(max, Number(tag.weight) || 0), 0);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM oj_prelim_question_tags WHERE question_id = ?').run(questionId);
    const insert = db.prepare(`INSERT INTO oj_prelim_question_tags (question_id, tag_slug, weight, is_primary, source)
      VALUES (?, ?, ?, ?, ?)`);
    normalized.forEach((tag) => {
      const weight = Number(tag.weight) || 0;
      insert.run(questionId, tag.slug, weight, weight > 0 && weight === maxWeight ? 1 : 0, source);
    });
  });
  tx();
  return normalized;
}

function syncExistingTags(db) {
  const problemRows = db.prepare('SELECT id, tags_json FROM problems').all();
  const updateProblem = db.prepare('UPDATE problems SET tags_json = ? WHERE id = ?');
  for (const row of problemRows) {
    let tags = [];
    try { tags = JSON.parse(row.tags_json || '[]'); } catch (_) { tags = []; }
    const normalized = syncProblemTags(db, row.id, tags, 'migrated');
    updateProblem.run(JSON.stringify(normalized), row.id);
  }

  const questionRows = db.prepare('SELECT id, tags_json FROM prelim_questions').all();
  const updateQuestion = db.prepare('UPDATE prelim_questions SET tags_json = ? WHERE id = ?');
  for (const row of questionRows) {
    let tags = [];
    try { tags = JSON.parse(row.tags_json || '[]'); } catch (_) { tags = []; }
    const normalized = syncPrelimQuestionTags(db, row.id, tags, 'migrated');
    updateQuestion.run(JSON.stringify(normalized), row.id);
  }
}

function initializeTagSystem(db) {
  seedTagDictionary(db);
  syncExistingTags(db);
}

function listTags(db, options = {}) {
  const scope = String(options.scope || '').trim();
  const keyword = String(options.keyword || '').trim();
  const params = [];
  const where = ['is_visible = 1', 'is_deprecated = 0'];
  if (scope && scope !== 'all') {
    where.push("(scope = 'all' OR scope = ?)");
    params.push(scope);
  }
  if (keyword) {
    const like = `%${keyword}%`;
    where.push('(slug LIKE ? OR name_zh LIKE ?)');
    params.push(like, like);
  }
  const rows = db.prepare(`SELECT * FROM oj_tags WHERE ${where.join(' AND ')} ORDER BY sort_order ASC, slug ASC`).all(...params);
  return rows.map((row) => ({
    slug: row.slug,
    nameZh: row.name_zh,
    name: row.name_zh,
    nameEn: row.name_en,
    parentSlug: row.parent_slug,
    level: row.level,
    nodeType: row.node_type,
    scope: row.scope,
    description: row.description,
    sortOrder: row.sort_order,
  }));
}

function listTagTree(db, options = {}) {
  const tags = listTags(db, options);
  const bySlug = new Map(tags.map((tag) => [tag.slug, { ...tag, children: [] }]));
  const roots = [];
  for (const tag of bySlug.values()) {
    const parent = tag.parentSlug ? bySlug.get(tag.parentSlug) : null;
    if (parent) parent.children.push(tag);
    else roots.push(tag);
  }
  return roots;
}

function resolveTagQuery(db, value) {
  const slug = cleanSlug(value);
  if (!slug) return '';
  if (seedTagMap.has(slug)) return slug;
  const row = db.prepare('SELECT slug FROM oj_tags WHERE slug = ? AND is_visible = 1 AND is_deprecated = 0').get(slug);
  return row ? row.slug : '';
}

module.exports = {
  cleanSlug,
  normalizeTagInput,
  normalizeTagList,
  tagDisplayName,
  tagSlug,
  tagNamesFromList,
  seedTagDictionary,
  syncProblemTags,
  syncPrelimQuestionTags,
  syncExistingTags,
  initializeTagSystem,
  listTags,
  listTagTree,
  resolveTagQuery,
};
