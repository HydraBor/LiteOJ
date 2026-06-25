const express = require('express');
const { db, parseJson } = require('../db');
const { normalizeGroupName } = require('../prelim-utils');
const { normalizeTagList, tagNamesFromList } = require('../tag-service');

const router = express.Router();
const ANALYTICS_GROUPS = ['CSP-J', 'CSP-S'];
const ANALYTICS_ROUNDS = ['初赛', '复赛'];
const FINAL_TASKS = ['T1', 'T2', 'T3', 'T4'];
const DIFFICULTY_LABELS = {
  unrated: '暂无评定',
  beginner: '入门',
  popular_minus: '普及−',
  improve_minus: '普及/提高−',
  popular_plus: '普及+/提高',
  province_minus: '提高+/省选−',
  noi_minus: '省选/NOI−',
  ctsc: 'NOI/NOI+/CTSC',
};

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

function normalizeRoundName(value) {
  const raw = String(value || '初赛').trim();
  return raw === '复赛' ? '复赛' : '初赛';
}

function parseFinalProblemId(id) {
  const m = String(id || '').toUpperCase().match(/^CSP([JS])(\d{2}|\d{4})T([1-4])$/);
  if (!m) return null;
  const yearNumber = Number(m[2]);
  const year = yearNumber < 100 ? 2000 + yearNumber : yearNumber;
  return {
    groupName: `CSP-${m[1]}`,
    year,
    task: `T${m[3]}`,
    taskNo: Number(m[3]),
  };
}

function difficultyLabel(value) {
  return DIFFICULTY_LABELS[value] || DIFFICULTY_LABELS.unrated;
}

function buildPrelimWhere(query) {
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

function prelimOptions(query = {}) {
  const groupName = query.groupName || query.group ? normalizeGroupName(query.groupName || query.group) : '';
  const params = [];
  const where = ['g.is_public = 1'];
  if (groupName) {
    where.push('p.group_name = ?');
    params.push(groupName);
  }
  const rows = db.prepare(`SELECT DISTINCT p.year, p.group_name
    FROM prelim_papers p
    JOIN prelim_groups g ON g.paper_id = p.id
    WHERE ${where.join(' AND ')}
    ORDER BY p.year DESC, p.group_name ASC`).all(...params);
  const years = [...new Set(rows.map((row) => row.year))].sort((a, b) => b - a);
  const dbGroups = new Set(rows.map((row) => row.group_name));
  return {
    years,
    groups: ANALYTICS_GROUPS.filter((group) => dbGroups.has(group) || ANALYTICS_GROUPS.includes(group)),
    rounds: ANALYTICS_ROUNDS,
    defaultYears: [],
    defaultGroup: '',
    defaultRound: '初赛',
  };
}

function finalProblemRows() {
  return db.prepare(`SELECT p.id, p.title, p.difficulty, p.tags_json, p.is_public,
      COUNT(DISTINCT s.id) AS submit_count,
      COUNT(DISTINCT CASE WHEN s.status = 'Accepted' THEN s.id END) AS ac_count
    FROM problems p
    LEFT JOIN submissions s ON s.problem_id = p.id
    WHERE p.is_public = 1
    GROUP BY p.id
    ORDER BY p.id ASC`).all()
    .map((row) => {
      const meta = parseFinalProblemId(row.id);
      return meta ? { ...row, ...meta } : null;
    })
    .filter(Boolean);
}

function finalOptions(query = {}) {
  const groupName = query.groupName || query.group ? normalizeGroupName(query.groupName || query.group) : '';
  const rows = finalProblemRows().filter((row) => !groupName || row.groupName === groupName);
  return {
    years: [...new Set(rows.map((row) => row.year))].sort((a, b) => b - a),
    groups: ANALYTICS_GROUPS,
    rounds: ANALYTICS_ROUNDS,
    defaultYears: [],
    defaultGroup: '',
    defaultRound: '初赛',
  };
}

function analyticsOptions(query = {}) {
  const roundName = normalizeRoundName(query.roundName || query.round);
  const options = roundName === '复赛' ? finalOptions(query) : prelimOptions(query);
  return { ...options, roundName };
}

function buildPrelimStats(query) {
  const { whereSql, params } = buildPrelimWhere(query);
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

  return {
    filters: {
      years,
      groupName: query.groupName || query.group || '',
      roundName: '初赛',
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
  };
}

function buildFinalStats(query) {
  const yearsFilter = parseYearList(query.years || query.year);
  const groupName = query.groupName || query.group ? normalizeGroupName(query.groupName || query.group) : '';
  const tagLabels = new Map(db.prepare('SELECT slug, name_zh FROM oj_tags').all().map((row) => [row.slug, row.name_zh]));
  const rows = finalProblemRows()
    .filter((row) => !groupName || row.groupName === groupName)
    .filter((row) => !yearsFilter.length || yearsFilter.includes(row.year))
    .sort((a, b) => a.year - b.year || a.groupName.localeCompare(b.groupName) || a.taskNo - b.taskNo || a.id.localeCompare(b.id));

  const tagScores = new Map();
  const tagCounts = new Map();
  const tagYearScores = new Map();
  const yearTotals = new Map();
  const difficultyCounts = new Map();
  const taskStats = new Map(FINAL_TASKS.map((task) => [task, {
    task,
    problemCount: 0,
    tagCounts: new Map(),
    difficultyCounts: new Map(),
    problems: [],
  }]));
  const problems = [];
  let totalScore = 0;

  for (const row of rows) {
    const score = 100;
    totalScore += score;
    addContribution(yearTotals, row.year, score);
    addCount(difficultyCounts, row.difficulty || 'unrated', 1);

    const tags = normalizeTagEntries(row.tags_json);
    const uniqueTags = new Map(tags.map((tag) => [tag.slug || tag.name, tag]));
    for (const tag of uniqueTags.values()) addCount(tagCounts, tag.slug || tag.name, 1);

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
      return { slug: key, tag: tagLabels.get(key) || tag.name || key, score: roundScore(contribution) };
    });

    const task = taskStats.get(row.task);
    if (task) {
      task.problemCount += 1;
      addCount(task.difficultyCounts, row.difficulty || 'unrated', 1);
      for (const tag of uniqueTags.values()) addCount(task.tagCounts, tag.slug || tag.name, 1);
      task.problems.push({ id: row.id, title: row.title, year: row.year, difficulty: row.difficulty || 'unrated', difficultyLabel: difficultyLabel(row.difficulty), tags: tagNamesFromList(parseJson(row.tags_json, [])) });
    }

    problems.push({
      id: row.id,
      title: row.title,
      year: row.year,
      groupName: row.groupName,
      task: row.task,
      taskNo: row.taskNo,
      difficulty: row.difficulty || 'unrated',
      difficultyLabel: difficultyLabel(row.difficulty),
      submitCount: row.submit_count || 0,
      acCount: row.ac_count || 0,
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
  const difficultyItems = [...difficultyCounts.entries()]
    .map(([difficulty, count]) => ({ difficulty, label: difficultyLabel(difficulty), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hans-CN'));
  const byTask = FINAL_TASKS.map((taskName) => {
    const stat = taskStats.get(taskName);
    const taskTags = [...stat.tagCounts.entries()]
      .map(([slug, count]) => ({ slug, tag: tagLabels.get(slug) || slug, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'));
    const taskDifficulties = [...stat.difficultyCounts.entries()]
      .map(([difficulty, count]) => ({ difficulty, label: difficultyLabel(difficulty), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hans-CN'));
    return {
      task: taskName,
      problemCount: stat.problemCount,
      topTags: taskTags.slice(0, 8),
      difficulties: taskDifficulties,
      problems: stat.problems.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id)),
    };
  });
  const heatmapTags = counts.slice(0, 12);
  const taskHeatmap = heatmapTags.map((tag) => ({
    slug: tag.slug,
    tag: tag.tag,
    counts: FINAL_TASKS.map((taskName) => taskStats.get(taskName).tagCounts.get(tag.slug) || 0),
  }));

  return {
    filters: { years, groupName, roundName: '复赛' },
    summary: {
      paperCount: years.length,
      problemCount: rows.length,
      questionCount: rows.length,
      totalScore: roundScore(totalScore),
      examPointCount: items.length,
      knowledgeCount: items.length,
      topTags: items.slice(0, 6),
      topDifficulties: difficultyItems.slice(0, 4),
    },
    counts,
    items,
    byYear,
    byTask,
    difficultyItems,
    taskHeatmap,
    problems,
    rule: '复赛分析以编程题题号识别年份、组别和题位，例如 CSPJ25T1 表示 2025 年 CSP-J 复赛 T1。每题按 100 分计入加权分值，知识点贡献沿用题目标签权重；T1-T4 统计分别展示各题位的知识点出现次数和难度分布。',
  };
}

router.get('/prelim/options', (req, res) => {
  res.json(prelimOptions(req.query));
});

router.get('/prelim/knowledge', (req, res) => {
  res.json(buildPrelimStats(req.query));
});

router.get('/options', (req, res) => {
  res.json(analyticsOptions(req.query));
});

router.get('/knowledge', (req, res) => {
  const roundName = normalizeRoundName(req.query.roundName || req.query.round);
  res.json(roundName === '复赛' ? buildFinalStats(req.query) : buildPrelimStats(req.query));
});

module.exports = router;
