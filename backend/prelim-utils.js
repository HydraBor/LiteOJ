const SECTION_LABELS = {
  single_choice: '单项选择题',
  program_reading: '阅读程序',
  code_completion: '完善程序',
};

const { normalizeTagInput, normalizeTagList, tagNamesFromList } = require('./tag-service');

function normalizeGroupName(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (/CSP[-_ ]?S|\bS\b/.test(raw)) return 'CSP-S';
  return 'CSP-J';
}

function normalizeQuestionType(value) {
  const raw = String(value || '').trim();
  if (['true_false', '判断题', '判断'].includes(raw)) return 'true_false';
  return 'single_choice';
}

function answerToStored(value) {
  const raw = String(value || '').trim();
  if (raw === '√' || raw === '对' || raw.toUpperCase() === 'T') return 'T';
  if (raw === '×' || raw === '错' || raw.toUpperCase() === 'F') return 'F';
  return raw.toUpperCase();
}

function storedAnswerLabel(answer) {
  if (answer === 'T') return '√';
  if (answer === 'F') return '×';
  return answer;
}

function parseScore(text) {
  const m = String(text || '').match(/（\s*([\d.]+)\s*分\s*）/);
  return m ? Number(m[1]) : 0;
}

function optionTextFromLines(lines) {
  const joined = lines.join('\n').replace(/　+/g, '  ');
  const matches = [...joined.matchAll(/(^|\s)([A-D])\.\s*/g)];
  if (!matches.length) return [];
  const options = [];
  for (let i = 0; i < matches.length; i += 1) {
    const key = matches[i][2];
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : joined.length;
    const text = joined.slice(start, end).trim().replace(/\s+$/g, '');
    options.push({ key, text });
  }
  return options;
}


function isIgnorablePaperLine(line) {
  const text = String(line || '').trim();
  return !text || /^-{3,}$/.test(text) || /^-\s*(判断题|单选题)\s*$/.test(text);
}

function compactPaperLines(lines) {
  return (lines || []).filter((line) => !isIgnorablePaperLine(line));
}

function parseTagWeights(payload, questionNumber) {
  const parts = String(payload || '').split(/[，,；;]/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) {
    const err = new Error(`第 ${questionNumber} 题缺少考点权重`);
    err.status = 400;
    throw err;
  }
  const bySlug = new Map();
  for (const part of parts) {
    const match = part.match(/^([a-z][a-z0-9-]*)\s*:\s*(\d+(?:\.\d+)?)\s*%?$/);
    if (!match) {
      const err = new Error(`第 ${questionNumber} 题考点格式错误：${part}；请使用 slug: 80%`);
      err.status = 400;
      throw err;
    }
    const slug = match[1];
    const weight = Number(match[2]);
    const tag = normalizeTagInput({ slug, weight });
    if (!tag) {
      const err = new Error(`第 ${questionNumber} 题使用了未登记的标签 slug：${slug}`);
      err.status = 400;
      throw err;
    }
    const current = bySlug.get(tag.slug) || { ...tag, weight: 0 };
    current.weight += weight;
    bySlug.set(tag.slug, current);
  }
  return normalizeTagList([...bySlug.values()], { throwOnUnknown: true });
}

function parseExplanation(body) {
  const match = String(body || '').match(/\*\*详细解析[:：]\*\*\s*([\s\S]*?)(?=\n\s*\*\*考点与权重[:：]\*\*|$)/i);
  if (!match) return '';
  const lines = match[1].trim().split('\n');
  while (lines.length && /^-{3,}$/.test(lines[0].trim())) lines.shift();
  while (lines.length && /^-{3,}$/.test(lines[lines.length - 1].trim())) lines.pop();
  return lines.join('\n').trim();
}

function parseAnswerAndExplanations(solutionMd) {
  const text = String(solutionMd || '').replace(/\r\n/g, '\n');
  const result = new Map();
  const re = /^#{2,3}\s+(\d+)\.\s*答案[:：]\s*([^\n]+)\n([\s\S]*?)(?=^#{2,3}\s+\d+\.\s*答案[:：]|^#\s+|$(?![\s\S]))/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const number = Number(m[1]);
    const answer = answerToStored(m[2]);
    const body = m[3] || '';
    const explanation = parseExplanation(body);
    const tagMatch = body.match(/\*\*考点与权重[:：]\*\*\s*([^\n]+)/i);
    if (!tagMatch) {
      const err = new Error(`第 ${number} 题缺少“考点与权重”行`);
      err.status = 400;
      throw err;
    }
    result.set(number, { answer, explanation, tags: parseTagWeights(tagMatch[1], number) });
  }
  return result;
}

function makeQuestionFromBlock({ number, score, section, rawStem, blockLines, solution }) {
  const stemLines = [rawStem.trim()];
  const optionLines = [];
  for (const extraLine of compactPaperLines(blockLines)) {
    const trimmed = extraLine.trim();
    if (/(^|\s|　)[A-D]\.\s*/.test(trimmed)) optionLines.push(trimmed);
    else stemLines.push(extraLine);
  }
  const answer = solution?.answer || '';
  const questionType = ['T', 'F'].includes(answer) ? 'true_false' : 'single_choice';
  let options = optionTextFromLines(optionLines);
  if (questionType === 'true_false') options = [{ key: 'T', text: '√' }, { key: 'F', text: '×' }];
  return {
    number,
    questionType,
    stem: compactPaperLines(stemLines).join('\n').trim(),
    score: Number.isFinite(score) ? score : 0,
    options,
    answer,
    explanation: solution?.explanation || '',
    tags: solution?.tags || [],
    sortOrder: number,
  };
}

function mergeTags(questions) {
  const map = new Map();
  for (const q of questions) {
    for (const tag of q.tags || []) {
      const normalized = normalizeTagInput(tag);
      if (!normalized?.slug) continue;
      const weight = typeof tag === 'string' ? 0 : Number(tag.weight) || 0;
      const current = map.get(normalized.slug) || { ...normalized, weight: 0 };
      current.weight += weight;
      map.set(normalized.slug, current);
    }
  }
  return [...map.values()].map((tag) => ({ ...tag, weight: Math.round(tag.weight / Math.max(questions.length, 1)) }));
}

function cleanGroupStem(lines) {
  return compactPaperLines((lines || []).map((x) => String(x || '').trimEnd()))
    .join('\n')
    .trim();
}

function parsePaperQuestions(paperMd, solutionMd, meta = {}) {
  const answerMap = parseAnswerAndExplanations(solutionMd);
  const lines = String(paperMd || '').replace(/\r\n/g, '\n').split('\n');
  let section = '';
  let groupNo = '';
  let groupHeading = '';
  let currentCode = '';
  let groupStemLines = [];
  const sectionTitles = {};
  const groupMap = new Map();
  const groups = [];

  function readCodeBlock(start) {
    const code = [];
    let i = start + 1;
    while (i < lines.length && !/^```/.test(lines[i].trim())) {
      code.push(lines[i]);
      i += 1;
    }
    return { code: code.join('\n'), end: i };
  }

  function groupKey(sec, gno, number) {
    return sec === 'single_choice' ? `single:${number}` : `${sec}:${gno || '1'}`;
  }

  function ensureGroup(sec, gno, number) {
    const key = groupKey(sec, gno, number);
    if (groupMap.has(key)) return groupMap.get(key);
    const group = {
      tempKey: key,
      number: sec === 'single_choice' ? number : (groups.filter((g) => g.section === sec).length + 1),
      firstQuestionNumber: number,
      section: sec,
      sectionLabel: SECTION_LABELS[sec] || sec,
      groupNo: sec === 'single_choice' ? '' : (gno || ''),
      title: sec === 'single_choice' ? `第 ${number} 题` : (groupHeading || `（${gno || groups.length + 1}）`),
      sectionTitle: sectionTitles[sec] || SECTION_LABELS[sec] || sec,
      stem: sec === 'single_choice' ? '' : cleanGroupStem(groupStemLines),
      code: sec === 'single_choice' ? '' : currentCode,
      questions: [],
      tags: [],
      score: 0,
      sortOrder: number,
    };
    groupMap.set(key, group);
    groups.push(group);
    return group;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s+一、/.test(line)) { section = 'single_choice'; sectionTitles[section] = line.replace(/^##\s*/, '').trim(); currentCode = ''; groupNo = ''; groupHeading = ''; groupStemLines = []; continue; }
    if (/^##\s+二、/.test(line)) { section = 'program_reading'; sectionTitles[section] = line.replace(/^##\s*/, '').trim(); currentCode = ''; groupNo = ''; groupHeading = ''; groupStemLines = []; continue; }
    if (/^##\s+三、/.test(line)) { section = 'code_completion'; sectionTitles[section] = line.replace(/^##\s*/, '').trim(); currentCode = ''; groupNo = ''; groupHeading = ''; groupStemLines = []; continue; }

    const groupMatch = line.match(/^###\s+（([^）]+)）\s*(.*)$/);
    if (groupMatch && section !== 'single_choice') {
      groupNo = groupMatch[1];
      groupHeading = `（${groupMatch[1]}）${String(groupMatch[2] || '').trim()}`;
      currentCode = '';
      groupStemLines = [];
      continue;
    }

    if (section !== 'single_choice' && /^```/.test(line.trim())) {
      const block = readCodeBlock(i);
      currentCode = block.code;
      i = block.end;
      continue;
    }

    const qMatch = line.match(/^(\d+)\.（([\d.]+)分）\s*([\s\S]*)$/);
    if (!qMatch || !section) {
      if (section !== 'single_choice' && groupNo && !currentCode && !isIgnorablePaperLine(line)) groupStemLines.push(line);
      continue;
    }

    const number = Number(qMatch[1]);
    const score = Number(qMatch[2]);
    const block = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (/^\d+\.（[\d.]+分）/.test(next)) break;
      if (/^##\s+/.test(next)) break;
      if (section !== 'single_choice' && /^###\s+（/.test(next)) break;
      block.push(next);
      j += 1;
    }
    i = j - 1;

    const solution = answerMap.get(number) || {};
    const question = makeQuestionFromBlock({
      number,
      score,
      section,
      rawStem: qMatch[3],
      blockLines: block,
      solution,
    });
    const group = ensureGroup(section, groupNo, number);
    group.questions.push(question);
    group.score += question.score || 0;
    group.tags = mergeTags(group.questions);
    if (section === 'single_choice') {
      group.stem = question.stem;
      group.tags = question.tags || [];
      group.score = question.score || 0;
      group.title = `第 ${number} 题`;
    }
  }

  const questions = groups.flatMap((g) => g.questions.map((q) => ({
    ...q,
    section: g.section,
    sectionLabel: g.sectionLabel,
    groupNo: g.groupNo,
    code: g.code,
    groupTitle: g.title,
  })));

  return {
    paper: {
      year: Number(meta.year) || 2025,
      groupName: normalizeGroupName(meta.groupName || 'CSP-J'),
      roundName: String(meta.roundName || '初赛').trim() || '初赛',
      title: String(meta.title || '').trim() || `${Number(meta.year) || 2025} ${normalizeGroupName(meta.groupName || 'CSP-J')} 初赛真题`,
      totalScore: Number(meta.totalScore) || 100,
    },
    groups: groups.map((g, idx) => ({ ...g, sortOrder: g.sortOrder || idx + 1 })),
    questions,
  };
}

function tagNamesFromJson(tags) {
  const arr = Array.isArray(tags) ? tags : [];
  return tagNamesFromList(arr);
}

function questionFromRow(row) {
  if (!row) return null;
  let options = [];
  let tags = [];
  try { options = JSON.parse(row.options_json || '[]'); } catch (_) { options = []; }
  try { tags = JSON.parse(row.tags_json || '[]'); } catch (_) { tags = []; }
  return {
    id: row.id,
    groupId: row.group_id,
    paperId: row.paper_id,
    number: row.number,
    questionType: row.question_type,
    questionTypeLabel: row.question_type === 'true_false' ? '判断题' : '单选题',
    stem: row.stem || '',
    score: row.score,
    options,
    answer: row.answer || '',
    answerLabel: storedAnswerLabel(row.answer || ''),
    explanation: row.explanation || '',
    tags,
    tagNames: tagNamesFromJson(tags),
    sortOrder: row.sort_order,
  };
}

function prelimQuestionFromRow(row) {
  if (!row) return null;
  const q = questionFromRow(row);
  return {
    ...q,
    paperTitle: row.paper_title,
    year: row.year,
    groupName: row.group_name,
    roundName: row.round_name,
    section: row.section,
    sectionLabel: SECTION_LABELS[row.section] || row.section,
    sectionTitle: row.section_title || '',
    groupNo: row.group_no || '',
    code: row.code || '',
    isPublic: Boolean(row.is_public),
    attemptCount: row.attempt_count || 0,
    correctCount: row.correct_count || 0,
    userResult: row.user_result ?? null,
    userAnswer: row.user_answer ?? null,
  };
}

function prelimGroupFromRow(row) {
  if (!row) return null;
  let tags = [];
  try { tags = JSON.parse(row.tags_json || '[]'); } catch (_) { tags = []; }
  return {
    id: row.id,
    paperId: row.paper_id,
    paperTitle: row.paper_title,
    year: row.year,
    groupName: row.group_name,
    roundName: row.round_name,
    number: row.number,
    firstQuestionNumber: row.first_question_number || row.number,
    title: row.title || '',
    section: row.section,
    sectionLabel: SECTION_LABELS[row.section] || row.section,
    sectionTitle: row.section_title || '',
    groupNo: row.group_no || '',
    stem: row.stem || '',
    code: row.code || '',
    tags,
    tagNames: tagNamesFromJson(tags),
    isPublic: Boolean(row.is_public),
    sortOrder: row.sort_order,
    questionCount: row.question_count || 0,
    score: row.score || 0,
    attemptCount: row.attempt_count || 0,
    correctCount: row.correct_count || 0,
    userAttemptedCount: row.user_attempted_count || 0,
    userCorrectCount: row.user_correct_count || 0,
    userWrongCount: row.user_wrong_count || 0,
  };
}

module.exports = {
  SECTION_LABELS,
  normalizeGroupName,
  normalizeQuestionType,
  answerToStored,
  storedAnswerLabel,
  parseAnswerAndExplanations,
  parsePaperQuestions,
  prelimQuestionFromRow,
  prelimGroupFromRow,
  questionFromRow,
  tagNamesFromJson,
};
