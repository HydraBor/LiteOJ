const express = require('express');
const { db, parseJson } = require('../db');
const { normalizeGroupName } = require('../prelim-utils');
const { normalizeTagList, tagNamesFromList } = require('../tag-service');

const router = express.Router();

function parseYearList(value) {
  const years = String(value || '')
    .split(',')
    .map((x) => Number(String(x).trim()))
    .filter((x) => Number.isInteger(x) && x > 0);
  return [...new Set(years)];
}

function normalizeTagEntries(tagsJson) {
  const raw = parseJson(tagsJson, []);
  const tags = normalizeTagList(raw);
  return tags.length ? tags : [{ slug: 'untagged', name: '未标注', nameZh: '未标注', weight: 1 }];
}

function contributionTagsForQuestion(tagsJson) {
  const tags = normalizeTagEntries(tagsJson);
  if (tags.length === 1) return [{ ...tags[0], weight: Number(tags[0].weight) || 1 }];
  const topTwo = [...tags]
    .sort((a, b) => (b.weight || 0) - (a.weight || 0) || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    .slice(0, 2);
  const totalWeight = topTwo.reduce((sum, tag) => sum + (Number(tag.weight) || 0), 0);
  if (totalWeight <= 0) return topTwo.map((tag) => ({ ...tag, weight: 1 }));
  return topTwo.map((tag) => ({ ...tag, weight: Number(tag.weight) || 0 }));
}

function addContribution(map, key, score) {
  map.set(key, (map.get(key) || 0) + score);
}

function addCount(map, key, count = 1) {
  map.set(key, (map.get(key) || 0) + count);
}

function roundScore(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function roundPercent(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function buildWhere(query) {
  const where = ['g.is_public = 1'];
  const params = [];
  const years = parseYearList(query.years || query.year);
  if (years.length) {
    where.push(`p.year IN (${years.map(() => '?').join(',')})`);
    params.push(...years);
  }
  if (query.groupName || query.group) {
    where.push('p.group_name = ?');
    params.push(normalizeGroupName(query.groupName || query.group));
  }
  return { whereSql: `WHERE ${where.join(' AND ')}`, params, years };
}

router.get('/prelim/options', (_req, res) => {
  const rows = db.prepare(`SELECT DISTINCT p.year, p.group_name
    FROM prelim_papers p
    JOIN prelim_groups g ON g.paper_id = p.id
    WHERE g.is_public = 1
    ORDER BY p.year DESC, p.group_name ASC`).all();
  const years = [...new Set(rows.map((row) => row.year))].sort((a, b) => b - a);
  const dbGroups = new Set(rows.map((row) => row.group_name));
  const groups = ['CSP-J', 'CSP-S'].filter((group) => dbGroups.has(group) || group === 'CSP-J');
  if (!groups.includes('CSP-S')) groups.push('CSP-S');
  res.json({
    years,
    groups,
    defaultYears: [],
    defaultGroup: '',
  });
});

router.get('/prelim/knowledge', (req, res) => {
  const { whereSql, params } = buildWhere(req.query);
  const rows = db.prepare(`SELECT q.id, q.number, q.score, q.tags_json,
      p.id AS paper_id, p.year, p.group_name, p.title AS paper_title
    FROM prelim_questions q
    JOIN prelim_groups g ON g.id = q.group_id
    JOIN prelim_papers p ON p.id = q.paper_id
    ${whereSql}
    ORDER BY p.year ASC, q.sort_order ASC, q.number ASC`).all(...params);

  const tagScores = new Map();
  const tagCounts = new Map();
  const tagYearScores = new Map();
  const yearTotals = new Map();
  const papers = new Map();
  const questionDetails = [];
  let totalScore = 0;
  const tagLabels = new Map(db.prepare('SELECT slug, name_zh FROM oj_tags').all().map((row) => [row.slug, row.name_zh]));

  for (const row of rows) {
    const score = Number(row.score) || 0;
    totalScore += score;
    addContribution(yearTotals, row.year, score);
    papers.set(row.paper_id, { id: row.paper_id, year: row.year, groupName: row.group_name, title: row.paper_title });

    const allTags = normalizeTagEntries(row.tags_json);
    const uniqueTags = new Map(allTags.map((tag) => [tag.slug || tag.name, tag]));
    for (const tag of (uniqueTags.size ? uniqueTags.values() : [{ slug: 'untagged', name: '未标注' }])) addCount(tagCounts, tag.slug || tag.name, 1);

    const contributionTags = contributionTagsForQuestion(row.tags_json);
    const rawWeightSum = contributionTags.reduce((sum, tag) => sum + (Number(tag.weight) || 0), 0);
    const weightSum = rawWeightSum > 0 ? rawWeightSum : (contributionTags.length || 1);
    const contributions = contributionTags.map((tag) => {
      const ratio = rawWeightSum > 0 ? ((Number(tag.weight) || 0) / weightSum) : (1 / contributionTags.length);
      const contribution = score * ratio;
      const key = tag.slug || tag.name;
      addContribution(tagScores, key, contribution);
      const yearMap = tagYearScores.get(key) || new Map();
      addContribution(yearMap, row.year, contribution);
      tagYearScores.set(key, yearMap);
      return { slug: key, tag: tag.name, score: roundScore(contribution) };
    });

    questionDetails.push({
      id: row.id,
      year: row.year,
      groupName: row.group_name,
      number: row.number,
      score: roundScore(score),
      tagNames: tagNamesFromList(parseJson(row.tags_json, [])),
      contributions,
    });
  }

  const years = [...yearTotals.keys()].sort((a, b) => a - b);
  const total = totalScore || 1;
  const items = [...tagScores.entries()]
    .map(([slug, score]) => ({ slug, tag: tagLabels.get(slug) || slug, score: roundScore(score), percent: roundPercent(score * 100 / total) }))
    .sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag, 'zh-Hans-CN'));

  const counts = [...tagCounts.entries()]
    .map(([slug, count]) => ({ slug, tag: tagLabels.get(slug) || slug, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'));

  const byYear = years.map((year) => {
    const yearTotal = yearTotals.get(year) || 0;
    const tags = items.map((item) => {
      const score = tagYearScores.get(item.slug)?.get(year) || 0;
      return { slug: item.slug, tag: item.tag, score: roundScore(score), percent: yearTotal ? roundPercent(score * 100 / yearTotal) : 0 };
    }).filter((item) => item.score > 0);
    return { year, totalScore: roundScore(yearTotal), tags };
  });

  res.json({
    filters: {
      years,
      groupName: req.query.groupName || req.query.group || '',
    },
    summary: {
      paperCount: papers.size,
      questionCount: rows.length,
      totalScore: roundScore(totalScore),
      examPointCount: items.length,
      knowledgeCount: items.length,
      topTags: items.slice(0, 6),
    },
    counts,
    items,
    byYear,
    questionDetails,
    papers: [...papers.values()].sort((a, b) => a.year - b.year || a.groupName.localeCompare(b.groupName)),
    rule: '考点出现次数按每小题去重后计数；加权分值按每个小题计算：1 个考点取满分值，2 个及以上考点只取权重最高的两个，并按二者权重比值分配该小题分值；权重缺失或均为 0 时平均分配。',
  });
});

module.exports = router;
