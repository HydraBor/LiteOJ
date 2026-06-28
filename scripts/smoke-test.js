const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  parseProblemCode,
  compareProblemCode,
  sortProblems,
} = require('../backend/problem-utils');
const { parsePaperQuestions, normalizeGroupName } = require('../backend/prelim-utils');
const { normalizeTagInput } = require('../backend/tag-service');
const {
  looksLikeFullCodeRequest,
  looksLikeProblemStatementOnly,
  looksLikeStudentCode,
  sanitizeFullCodeOutput,
  violatesFullCodePolicy,
} = require('../backend/ai-prompts');
const { compareOutput } = require('../judge/checker');
const { applyScoring } = require('../judge/runner');

function ids(list) { return list.map((x) => x.id); }

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
assert.strictEqual(packageJson.version, '1.4.3', 'package version should be 1.4.3 after 小轻 code-hiding guardrails');
assert(!('sync-cutoffs' in packageJson.scripts), 'retired cutoff synchronization script should not remain in package scripts');
assert.strictEqual(packageJson.scripts['reset-admin'], 'node scripts/reset-admin.js', 'package scripts should expose a safe admin reset utility');
assert(!fs.existsSync(path.join(__dirname, '..', 'scripts', 'sync-cutoffs.js')), 'retired cutoff synchronization script should be removed');
assert(!fs.existsSync(path.join(__dirname, '..', 'seed', 'cutoffs')), 'retired cutoff seed directory should be removed');
for (const doc of ['docs/DEVELOPMENT.md', 'docs/USER_MANUAL.md', 'docs/DEPLOYMENT.md', 'docs/ARCHITECTURE.md', 'docs/FINAL_REVIEW.md']) {
  assert(fs.existsSync(path.join(__dirname, '..', doc)), `missing project document ${doc}`);
}
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
assert(readme.includes('开发文档') && readme.includes('使用手册') && readme.includes('部署手册'), 'README should link the integrated documentation set');
assert(!readme.includes('作答方式') && !readme.includes('分数线种子'), 'README should not keep retired preliminary filter/cutoff wording');
const deploymentDoc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'DEPLOYMENT.md'), 'utf8');
assert(!readme.includes('litoj.sh') && !deploymentDoc.includes('litoj.sh'), 'docs should not document misspelled startup scripts');
assert(readme.includes('./start.sh') && deploymentDoc.includes('./start.sh'), 'docs should document start.sh as the primary deployment entrypoint');
assert(readme.includes('./start.sh backup') && readme.includes('./start.sh restore') && deploymentDoc.includes('./start.sh data-volume'), 'docs should document script-based backup and restore commands');
assert(deploymentDoc.includes('Docker Hub 超时处理') && deploymentDoc.includes('node:22-bookworm-slim'), 'deployment docs should include Docker Hub timeout recovery');
const dbJsFinal = fs.readFileSync(path.join(__dirname, '..', 'backend', 'db.js'), 'utf8');
assert(!dbJsFinal.includes('prelim_cutoffs'), 'final simplified analytics should not create or migrate cutoff tables');
assert(!dbJsFinal.includes('scoring_mode'), 'retired scoring_mode column should not be created or migrated for new databases');
assert(dbJsFinal.includes('CREATE TABLE IF NOT EXISTS app_settings') && dbJsFinal.includes('CREATE TABLE IF NOT EXISTS ai_sessions') && dbJsFinal.includes('CREATE TABLE IF NOT EXISTS ai_messages'), 'database migration should create AI settings, sessions, and message history tables');
const securityJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'security.js'), 'utf8');
const profileRoutesJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'profile.js'), 'utf8');
const passwordsJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'passwords.js'), 'utf8');
assert(securityJs.includes('X-Content-Type-Options') && securityJs.includes('Cache-Control') && securityJs.includes('staticOptions'), 'security middleware should set nosniff and cache headers');
assert(passwordsJs.includes('bcrypt') && passwordsJs.includes('hashPassword') && passwordsJs.includes('verifyPassword'), 'password helper should centralize bcrypt hashing and verification');
assert(profileRoutesJs.includes("router.post('/password'") && profileRoutesJs.includes('requireLogin') && profileRoutesJs.includes('hashPassword'), 'profile route should support logged-in password changes');


assert.strictEqual(parseProblemCode('P1001'), 'P1001');
assert.strictEqual(parseProblemCode('ABC12'), 'ABC12');
assert.strictEqual(parseProblemCode('CSPJ25T1'), 'CSPJ25T1');
assert.strictEqual(parseProblemCode('CSPS2025T4'), 'CSPS2025T4');
assert.strictEqual(parseProblemCode('p1001'), null);
assert.strictEqual(parseProblemCode('1001'), null);
assert.strictEqual(parseProblemCode('P-1001'), null);
assert.strictEqual(parseProblemCode('P1001A'), null);
assert.strictEqual(parseProblemCode('CSP-J25T1'), null);
assert.deepStrictEqual(['P10', 'ABC10', 'ABC2', 'B1', 'P1'].sort(compareProblemCode), ['ABC2', 'ABC10', 'B1', 'P1', 'P10']);
assert.deepStrictEqual(['CSPJ25T4', 'CSPJ25T1', 'CSPJ24T3'].sort(compareProblemCode), ['CSPJ24T3', 'CSPJ25T1', 'CSPJ25T4']);
assert.deepStrictEqual(ids(sortProblems([
  { id: 'P10', title: 'x' },
  { id: 'P2', title: 'x' },
  { id: 'A100', title: 'x' },
  { id: 'A2', title: 'x' },
  { id: 'AA1', title: 'x' },
])), ['A2', 'A100', 'AA1', 'P2', 'P10']);

assert(compareOutput('1  2\n3\n', '1 2 3\n', { mode: 'ignore_space' }), 'ignore_space checker should compare token streams');
assert(compareOutput('Yes\n', 'yes\n', { mode: 'case_insensitive' }), 'case_insensitive checker should ignore letter case');
assert(compareOutput('3.1415926\n', '3.141593\n', { mode: 'float', tolerance: 0.00001 }), 'float checker should accept answers within tolerance');
assert(!compareOutput('3.14\n', '3.20\n', { mode: 'float', tolerance: 0.00001 }), 'float checker should reject answers outside tolerance');
const pointScore = applyScoring([
  { caseId: 1, status: 'Accepted', rawScore: 30, score: 0 },
  { caseId: 2, status: 'Wrong Answer', rawScore: 30, score: 0 },
  { caseId: 3, status: 'Accepted', rawScore: 40, score: 0 },
]);
assert.strictEqual(pointScore.score, 70, 'plain test cases should add accepted case scores');
const subtaskScore = applyScoring([
  { caseId: 1, subtask: 's1', status: 'Accepted', rawScore: 30, score: 0 },
  { caseId: 2, subtask: 's1', status: 'Wrong Answer', rawScore: 30, score: 0 },
  { caseId: 3, subtask: 's2', status: 'Accepted', rawScore: 40, score: 0 },
]);
assert.strictEqual(subtaskScore.status, 'Partially Accepted', 'subtask scoring should keep partial status');
assert.strictEqual(subtaskScore.score, 40, 'failed subtask should award zero for every case in the group');

const paperMd = fs.readFileSync(path.join(__dirname, '..', 'seed', 'prelim', '2025-CSP-J1.md'), 'utf8');
const solutionMd = fs.readFileSync(path.join(__dirname, '..', 'seed', 'prelim', '2025-CSP-J1-solution.md'), 'utf8');
const parsedPrelim = parsePaperQuestions(paperMd, solutionMd, { year: 2025, groupName: 'CSP-J', title: '2025 CSP-J 初赛真题' });
assert.strictEqual(normalizeGroupName('CSP-J'), 'CSP-J');
assert.strictEqual(normalizeGroupName('CSP-S'), 'CSP-S');
assert.strictEqual(parsedPrelim.questions.length, 43, '2025 CSP-J1 seed should parse 43 subquestions');
assert.strictEqual(parsedPrelim.groups.length, 20, '2025 CSP-J1 seed should parse 20 grouped items');
assert.strictEqual(parsedPrelim.paper.totalScore, 100, 'mock exam total should follow official paper total, not rounded raw question sum');
assert.strictEqual(parsedPrelim.questions.reduce((sum, q) => sum + q.score, 0), 100, 'seed raw score should match the official 100-point paper after score correction');
assert.strictEqual(parsedPrelim.questions.find((q) => q.number === 16).score, 1, 'question 16 should be corrected to 1 point');
assert.deepStrictEqual(parsedPrelim.questions.find((q) => q.number === 1).tags.map((t) => t.slug), ['data-type', 'integer-representation'], 'question 1 tags should use fixed slug-only tags');
assert.deepStrictEqual(parsedPrelim.questions.find((q) => q.number === 1).tags.map((t) => t.name), ['数据类型', '整数表示'], 'question 1 tags should display the fixed Chinese names');
assert(!parsedPrelim.questions.some((q) => /^---$/m.test(q.explanation || '')), 'preliminary explanations should not keep Markdown horizontal-rule separators');
assert.strictEqual(normalizeTagInput('语言入门'), null, 'Chinese tag names should not resolve in the slug-only tag system');
assert.strictEqual(parsedPrelim.questions.find((q) => q.number === 1).answer, 'A');
assert.strictEqual(parsedPrelim.questions.find((q) => q.number === 16).questionType, 'true_false');
assert.strictEqual(parsedPrelim.questions.find((q) => q.number === 16).answer, 'T');
assert(parsedPrelim.groups.find((g) => g.section === 'program_reading' && g.groupNo === '1').code.length > 100, 'program reading groups should keep shared code');
assert(parsedPrelim.groups.find((g) => g.section === 'code_completion' && g.groupNo === '1').code.includes('____①____'), 'completion groups should keep blank code');
assert.deepStrictEqual(parsedPrelim.groups.find((g) => g.section === 'program_reading' && g.groupNo === '1').questions.map((q) => q.number), [16,17,18,19,20,21]);
assert(!parsedPrelim.questions.some((q) => /^-\s*(判断题|单选题)/.test(q.stem)), 'paper parser should ignore Markdown type separator lines in question stems');
assert(!parsedPrelim.questions.some((q) => /^-{3,}$/.test(q.stem.trim())), 'paper parser should ignore Markdown horizontal rule separators');
assert(parsedPrelim.groups.find((g) => g.section === 'single_choice').sectionTitle.includes('一、单项选择题'), 'section heading should be preserved from the original paper markdown');
assert(parsedPrelim.groups.find((g) => g.section === 'program_reading' && g.groupNo === '1').sectionTitle.includes('二、阅读程序'), 'program reading heading should be preserved');
assert(parsedPrelim.groups.find((g) => g.section === 'code_completion' && g.groupNo === '1').title.includes('字符串解码'), 'completion group title should keep original subtitle');
assert(parsedPrelim.questions.every((q) => q.tags && q.tags.length), 'each seed question should have tags');
const expectedPrelimQuestionCounts = {
  2019: 43,
  2020: 43,
  2021: 43,
  2022: 44,
  2023: 42,
  2024: 42,
  2025: 43,
};
for (const [year, count] of Object.entries(expectedPrelimQuestionCounts)) {
  const paper = fs.readFileSync(path.join(__dirname, '..', 'seed', 'prelim', `${year}-CSP-J1.md`), 'utf8');
  const solution = fs.readFileSync(path.join(__dirname, '..', 'seed', 'prelim', `${year}-CSP-J1-solution.md`), 'utf8');
  const parsed = parsePaperQuestions(paper, solution, { year: Number(year), groupName: 'CSP-J' });
  const sections = parsed.groups.reduce((acc, group) => {
    acc[group.section] = (acc[group.section] || 0) + 1;
    return acc;
  }, {});
  assert.strictEqual(parsed.questions.length, count, `${year} CSP-J1 question count should remain stable`);
  assert.deepStrictEqual(sections, { single_choice: 15, program_reading: 3, code_completion: 2 }, `${year} CSP-J1 section grouping should remain stable`);
}
const tagSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'tag-schema.json'), 'utf8'));
assert(tagSchema.tags.some((tag) => tag.slug === 'thinking' && tag.nameZh === '思维'), 'tag schema should include the latest imported thinking tag');
assert(!tagSchema.tags.some((tag) => ['run-length-encoding', 'majority-vote'].includes(tag.slug)), 'tag schema should follow the latest provided tag standard');

for (const year of [2019, 2020, 2021, 2022, 2023, 2024, 2025]) {
  const yPaper = fs.readFileSync(path.join(__dirname, '..', 'seed', 'prelim', `${year}-CSP-J1.md`), 'utf8');
  const ySolution = fs.readFileSync(path.join(__dirname, '..', 'seed', 'prelim', `${year}-CSP-J1-solution.md`), 'utf8');
  const yParsed = parsePaperQuestions(yPaper, ySolution, { year, groupName: 'CSP-J', title: `${year} CSP-J 初赛真题`, totalScore: 100 });
  assert.strictEqual(yParsed.groups.length, 20, `${year} CSP-J1 seed should parse 20 grouped items`);
  assert(yParsed.questions.length >= 40, `${year} CSP-J1 seed should parse all subquestions`);
  assert.strictEqual(yParsed.questions.reduce((sum, q) => sum + q.score, 0), 100, `${year} CSP-J1 raw score should be 100`);
  assert(!yParsed.questions.some((q) => !q.answer), `${year} CSP-J1 should not miss answers`);
}
const parsed2022 = parsePaperQuestions(
  fs.readFileSync(path.join(__dirname, '..', 'seed', 'prelim', '2022-CSP-J1.md'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '..', 'seed', 'prelim', '2022-CSP-J1-solution.md'), 'utf8'),
  { year: 2022, groupName: 'CSP-J', title: '2022 CSP-J 初赛真题', totalScore: 100 },
);
assert.strictEqual(parsed2022.questions.find((q) => q.number === 1).score, 2, '2022 question score after number should be parsed');
assert.strictEqual(parsed2022.questions.find((q) => q.number === 16).score, 1.5, '2022 reading score after number should be parsed');


const analyticsRoutes = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'analytics.js'), 'utf8');
assert(analyticsRoutes.includes("function roundPercent(value)"), 'analytics route should define a percentage formatter');
assert(!analyticsRoutes.includes('* 1000) / 10'), 'analytics percentage should not multiply percent points by 10');
assert(analyticsRoutes.includes('* 10) / 10'), 'analytics percentage should round percent points to one decimal place');
assert(analyticsRoutes.includes('score * 100 / total') && analyticsRoutes.includes('score * 100 / yearTotal'), 'analytics percentages should divide contribution by total score before formatting');
assert(analyticsRoutes.includes('const tagCounts = new Map()') && analyticsRoutes.includes('addCount(tagCounts'), 'analytics should count exam point occurrences for the first chart');
assert(analyticsRoutes.includes('contributionTagsForQuestion') && analyticsRoutes.includes('.slice(0, 2)'), 'analytics should only use the top two weighted tags for score contribution');
assert(analyticsRoutes.includes('counts,') && analyticsRoutes.includes('items,') && analyticsRoutes.includes('byYear,'), 'analytics API should return counts, weighted scores, and year comparison data');
assert(analyticsRoutes.includes('defaultYears: []') && analyticsRoutes.includes("defaultGroup: ''"), 'analytics options should not preselect year or group');
assert(analyticsRoutes.includes("function selectedRoundName(value)") && analyticsRoutes.includes("defaultRound: ''"), 'analytics options should not preselect round before the user chooses a session');
assert(analyticsRoutes.includes('examPointCount') && analyticsRoutes.includes('knowledgeCount'), 'analytics summary should expose current exam-point count while keeping compatibility');
assert(analyticsRoutes.includes("router.get('/options'") && analyticsRoutes.includes("router.get('/knowledge'") && analyticsRoutes.includes('parseFinalProblemId'), 'analytics route should expose unified preliminary/final analysis endpoints');
assert(analyticsRoutes.includes('FINAL_TASKS') && analyticsRoutes.includes('taskHeatmap') && analyticsRoutes.includes('difficultyItems'), 'final-round analytics should summarize T1-T4, heatmap, and difficulty data');
assert(analyticsRoutes.includes('复赛不计算考点权重') && analyticsRoutes.includes('tagYearCounts'), 'final-round analytics should count tag occurrences instead of weighted scores');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'app.js'), 'utf8');
const outsideUiNamePattern = new RegExp(['hy', 'dro', '|', 'ac', 'go'].join(''), 'i');
const cssModuleNamePattern = /[A-Za-z]+_[A-Za-z0-9]+__/;

assert(appJs.includes('analyticsYearDropdown') && appJs.includes('analyticsGroupSelect') && appJs.includes('analyticsRoundSelect'), 'frontend analytics should use compact group/round/year filters');
assert(appJs.includes('请选择场次') && appJs.includes("const selectedRound = params.get('roundName') || params.get('round') || ''"), 'analytics round filter should start with an empty placeholder');
assert(appJs.includes('compact-analytics-filter') && appJs.includes('filter-panel-grid') && !appJs.includes('analytics-filter-field') && !appJs.includes('page-head analytics-head'), 'analytics filter should follow the shared filter panel grid instead of custom field wrappers or page head');
assert(!appJs.includes('按年份和组别统计初赛题库中的知识点出现次数与加权分值贡献。') && !appJs.includes("routeLink('/prelim', '返回初赛题库'") && !appJs.includes('<h1>数据分析</h1>'), 'analytics page should remove redundant title, explanatory text, and return link');
assert(appJs.includes('考点出现次数') && appJs.includes('考点加权分值') && appJs.includes('考点/年份对照表') && !appJs.includes('知识点出现次数') && !appJs.includes('知识点加权分值') && !appJs.includes('知识点/年份对照表'), 'analytics page should use 考点 wording');
assert(!appJs.includes('<h1>后台管理</h1>') && !appJs.includes('<h1>个人主页</h1>') && !appJs.includes('查看账号信息并修改登录密码。') && !appJs.includes('密码会使用 bcrypt 单向哈希存储'), 'admin/profile pages should not render removed headings or password storage hint');
assert(appJs.includes('analyticsCountBarChart') && appJs.includes('analyticsDonutChart') && appJs.includes('analyticsYearCompare'), 'frontend analytics should render count bar chart, weighted donut chart, and year comparison table');
assert(appJs.includes('analyticsFinalTaskCards') && appJs.includes('analyticsTaskHeatmap') && appJs.includes('analyticsDifficultyChart'), 'frontend analytics should render final-round T1-T4, heatmap, and difficulty charts');
assert(appJs.includes('analyticsFinalYearCompare') && appJs.includes("selectedRound === '复赛' ? analyticsFinalYearCompare"), 'frontend final-round analytics should compare yearly tag counts');
assert(appJs.includes('analytics-stack') && appJs.includes('analytics-wide-card'), 'final-round task cards and heatmap should render as separate full-width rows');
assert(!appJs.includes("tag: '其他'") && !appJs.includes("tag: \"其他\""), 'analytics weighted donut should expand all exam points instead of merging them into 其他');
assert(!appJs.includes('/api/analytics/prelim/cutoffs') && !appJs.includes('name="province"'), 'frontend analytics should not load cutoff lines or render province filters in the simplified version');
assert(!outsideUiNamePattern.test(appJs) && !cssModuleNamePattern.test(appJs), 'frontend templates should use LiteOJ-owned semantic class names');
for (const fn of ['editProblem', 'openProblemData', 'toggleProblem', 'cloneProblem', 'deleteProblem', 'deleteCase', 'rejudgeProblem']) {
  assert(appJs.includes(`window.${fn}`), `missing ${fn}`);
}
for (const text of ['renderPrelimList', 'renderPrelimItem', 'renderPrelimAdmin', 'renderPrelimImport', 'renderMockHome', 'renderMockExam', 'renderMockReport', 'prelimOption', 'shouldShowPrelimGroupStem', 'sectionTitleFromGroups', 'numberedStem', 'questionScoreInline', 'questionPaperStem', 'renderMockExamSections', 'renderMockReportSections', 'formatScore', 'bindMockOptionEvents', 'mock-option-input', 'subquestion-meta', 'bindProblemManageActions', 'data-problem-action=\"toggle\"', 'data-problem-action=\"clone\"', 'renderCheckerPanel', 'highlightCode', 'uploadProblemAttachment', 'currentProblemIdForAttachment']) {
  assert(appJs.includes(text), `frontend missing ${text}`);
}

assert(!appJs.includes('CSP-J/S 初赛模考'), 'mock home should not show redundant banner title');
assert(!appJs.includes('自动从初赛题库组卷'), 'mock home should not show redundant explanatory text');
assert(!appJs.includes('mock-tabs'), 'mock home should not render redundant tab switcher');
assert(appJs.includes('label class="mock-keyword">关键词'), 'mock filter keyword input should have a visible label');

assert(/function\s+attrEsc\s*\(/.test(appJs), 'Markdown editor toolbar should define attrEsc before renderProblemEditor uses it');
assert(appJs.includes('encodeURIComponent(String(value ??') && appJs.includes('decodeURIComponent(value ||'), 'Markdown toolbar insertion values should be safely encoded/decoded for data attributes');
assert(appJs.includes('esc(decodeAttrValue(input.dataset.tagLabel || input.value))'), 'selected problem tag chips should decode stored Chinese labels before display');
assert(!appJs.includes('href="javascript:nav('), 'SPA routes should not use fragile javascript:nav hrefs');

assert(!appJs.includes('进入最新试卷'), 'prelim list should not show latest paper shortcut');
assert(!appJs.includes('程序阅读题和代码补全题按整题展示'), 'prelim list should not show redundant explanatory text');
assert(!appJs.includes('<h1>初赛题库</h1>'), 'prelim list should not show redundant page hero title');
assert(!appJs.includes('<label>作答'), 'prelim filter should not show retired answer/question-type filter');
assert(!appJs.includes("const keys = ['keyword','year','groupName','section','questionType'") && !appJs.includes('name="questionType"'), 'prelim filter should not send retired questionType query');
assert(appJs.includes('prelim-filter-card'), 'prelim list should start with a clean filter card');
assert(appJs.includes("typeof tag !== 'object'") && appJs.includes('return String(tag);'), 'filter option rendering should support numeric year facets');
assert(!appJs.includes('第 ${q.number} 题${questionScoreInline(q)}') && !appJs.includes('第 ${item.firstQuestionNumber || item.number} 题${questionScoreInline(item)}'), 'prelim list titles should not duplicate the score after the question number');
assert(appJs.includes('class="prelim-type-cell"') && appJs.includes('class="prelim-type-chip"'), 'prelim list should use non-wrapping type chips');
assert(!appJs.includes('esc(item.paperTitle'), 'prelim list and item header should not repeat the paper title under each item');
assert(appJs.includes('window.startMockExam = async'), 'mock start handler should be exported correctly');

assert(appJs.includes('/logo-mark.svg'), 'auth page should use the SVG LiteOJ mark');
assert(appJs.includes('async function renderProfile') && appJs.includes('/api/profile/password') && appJs.includes("path === '/profile'"), 'frontend should provide a profile page for password changes');
assert(appJs.includes('async function renderAiPage') && appJs.includes('/api/ai/sessions') && appJs.includes('readAiEventStream') && appJs.includes("path === '/ai'"), 'frontend should provide an authenticated AI chat page with streaming reads');
assert(appJs.includes('createAiSessionAction') && appJs.includes('renameAiSessionAction') && appJs.includes('deleteAiSessionAction') && appJs.includes('sendAiMessageAction'), 'AI frontend global handlers should call private action functions instead of recursively calling themselves');
assert(!appJs.includes('window.createAiSession = () => runUiAction(createAiSession)') && !appJs.includes('window.sendAiMessage = (sessionId) => runUiAction(() => sendAiMessage(sessionId))'), 'AI frontend should avoid recursive global handler wrappers');
assert(appJs.includes('你好小轻') && appJs.includes('会话记录') && appJs.includes('你好，我是小轻👋'), 'AI frontend should present 小轻 branding, history wording, and welcome state');
assert(appJs.includes('aiComposerHtml(config, disabledReason)') && appJs.includes('messages.map((msg) => aiMessageHtml(msg)).join'), 'AI frontend should render the message area and reusable bottom composer');
assert(appJs.includes("if (!activeSessionId)") && appJs.includes("POST', body: { title: '新会话' }") && appJs.includes("history.replaceState(null, '', `/ai?session=${activeSessionId}`)"), 'AI frontend should auto-create a session when sending from the welcome page');
assert(appJs.includes('async function renderAdminAiSettings') && appJs.includes('/api/admin/ai-settings') && appJs.includes("path === '/admin/ai'"), 'frontend should provide an admin AI settings page');
assert(appJs.includes('renderMarkdown(assistantContent)') && appJs.includes('ai-message-content'), 'AI frontend should render streamed Markdown content with the shared renderer');
assert(appJs.includes('function aiLoadingHtml') && appJs.includes("event === 'stage'") && appJs.includes('用户请求分析中'), 'AI frontend should show progress stages while waiting for reviewed replies');
assert(appJs.includes('resetUserPassword') && appJs.includes('/reset-password') && appJs.includes('123456'), 'user admin page should expose password reset to 123456');
assert(appJs.includes('handleUserAdminAction') && appJs.includes("app.addEventListener('click', handleUserAdminAction)") && appJs.includes("decodeAttrValue(btn.dataset.username"), 'user admin actions should use stable delegated click handling');
assert(appJs.includes("routeAnchor('/profile'"), 'logged-in user box should link to the profile page');
assert(!appJs.includes('<h1>提交记录</h1>'), 'submissions page should not render a redundant page title');
assert(appJs.includes('clearSubmissionPoll') && appJs.includes('location.pathname !== expectedPath'), 'submission polling should stop refreshing after the user leaves the submission page');
assert(appJs.includes('function formatUtc8Time') && appJs.includes('UTC+8'), 'submission times should be formatted explicitly as UTC+8');
assert(appJs.includes('DEFAULT_PAGE_SIZE = 20') && appJs.includes('PAGE_SIZE_OPTIONS = [10, 20, 50, 100]'), 'list pagination should default to 20 rows and expose stable page-size choices');
assert(appJs.includes('renderPagination') && appJs.includes('page-size-select') && appJs.includes('paginateItems'), 'frontend lists should use the shared pagination component');
assert(appJs.includes("renderPagination('/problems'") && appJs.includes("renderPagination('/prelim'") && appJs.includes("renderPagination('/prelim/mock'") && appJs.includes("renderPagination('/admin/problems'"), 'primary problem/prelim/mock/admin lists should render pagination controls');
assert(appJs.includes("paperPageSize") && appJs.includes("itemPageSize") && !appJs.includes("prelim/questions?all=1"), 'prelim admin should paginate papers/items separately and avoid loading all subquestions');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'index.html'), 'utf8');
assert(indexHtml.includes('/logo.svg'), 'index.html should apply the full logo');
assert(indexHtml.includes('/logo-mark.svg'), 'index.html should apply the favicon mark');
assert(indexHtml.includes('id="aiNav"') && indexHtml.includes('data-route="/ai"') && indexHtml.includes('你好小轻'), 'main navigation should expose the 小轻 page to logged-in users');
assert(fs.existsSync(path.join(__dirname, '..', 'frontend', 'public', 'logo.svg')), 'full logo SVG should exist');
assert(fs.existsSync(path.join(__dirname, '..', 'frontend', 'public', 'logo-mark.svg')), 'logo mark SVG should exist');
const logoMark = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'logo-mark.svg'), 'utf8');
assert(logoMark.includes('fill="white"'), 'selected logo mark should use a white L');
assert(!logoMark.includes('lightning') && !logoMark.includes('bolt'), 'selected logo mark should be the clean L version, not the lightning concept');


for (const endpoint of ["'/status'", "'/clone'", "'/rejudge'", "'/cases/zip'", "'/attachments'", "'/checker'"]) {
  assert(appJs.includes(endpoint), `frontend does not reference ${endpoint}`);
}
assert(appJs.includes("problemApi(problemId, '/cases')") && appJs.includes("problemApi(problemId, '/cases/bulk')") && appJs.includes('renderCaseOverview') && appJs.includes('bindCaseDragAndDrop'), 'testdata manager should render a lightweight grouped overview and persist drag-and-drop case layout');
assert(appJs.includes('caseSubtaskMode') && appJs.includes('manualCaseDraftItem') && !appJs.includes(`/cases/${'${caseId}'}?content=1`), 'testdata manager should expose global subtask/manual modes and avoid loading large case contents for editing');
assert(appJs.includes('activeCaseDragRows') && appJs.includes('case-subtask-score-field') && appJs.includes('分值:<input') && !appJs.includes('测试数据管理：') && !appJs.includes('权重:'), 'testdata manager should use compact score-based subtask UI and multi-selected drag rows');
assert(appJs.includes('name="specialJudge"') && appJs.includes('renderCheckerPanel') && appJs.includes("problemApi(problemId, '/checker')") && !appJs.includes('输出比较') && !appJs.includes('浮点误差'), 'problem editor and data manager should expose Special Judge without legacy compare/tolerance UI');

const prelimRoutes = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'prelim.js'), 'utf8');
assert(prelimRoutes.includes('truthPaperTitle') && prelimRoutes.includes('displayMockExamTitle') && prelimRoutes.includes('真题卷'), 'prelim true-paper flow should name papers as 真题卷 and normalize old mock titles');
for (const route of ["router.get('/items'", "router.get('/items/:id'", "router.post('/questions/:id/check'", "router.post('/import-md'", "router.get('/facets'", "router.get('/mock/papers'", "router.post('/mock/start'", "router.post('/mock/exams/:id/submit'", 'scoreTotalForMock', 'clampScoreToTotal']) {
  assert(prelimRoutes.includes(route), `missing prelim backend route ${route}`);
}
assert(!prelimRoutes.includes('req.query.questionType') && !prelimRoutes.includes('questionTypes:'), 'prelim backend should not keep retired question-type filter/facet logic');


const serverJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'server.js'), 'utf8');
assert(serverJs.includes("app.disable('x-powered-by')") && serverJs.includes('setSecurityHeaders') && serverJs.includes('staticOptions') && serverJs.includes("/api/profile"), 'server should install security headers, disable x-powered-by, and mount profile routes');
assert(serverJs.includes("const aiRoutes = require('./routes/ai')") && serverJs.includes("app.use('/api/ai', aiRoutes)"), 'server should mount authenticated AI chat routes');
assert(serverJs.includes("const HOST = process.env.HOST || '127.0.0.1'") && serverJs.includes('app.listen(PORT, HOST'), 'server should default to loopback binding unless HOST is explicitly provided');
assert(serverJs.includes("res.setHeader('Cache-Control', 'no-cache')"), 'SPA fallback should set a Cache-Control header');
const authJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'auth.js'), 'utf8');
const authRoutesJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'auth.js'), 'utf8');
const adminRoutesJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'admin.js'), 'utf8');
const aiRoutesJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'ai.js'), 'utf8');
const settingsJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'settings.js'), 'utf8');
assert(securityJs.includes('function createRateLimit') && securityJs.includes('Retry-After'), 'security helper should expose lightweight API rate limiting');
assert(authRoutesJs.includes('hashPassword(password)') && authRoutesJs.includes('verifyPassword(password, row.password_hash)') && !authRoutesJs.includes('bcrypt.compareSync'), 'auth routes should use centralized bcrypt password helpers');
assert(authRoutesJs.includes('LOGIN_RATE_LIMIT') && authRoutesJs.includes('REGISTER_RATE_LIMIT'), 'auth routes should rate-limit login and registration');
assert(authRoutesJs.includes("process.env.NODE_ENV !== 'production'"), 'production registration should not let the first public registrant become admin');
assert(adminRoutesJs.includes("router.post('/users/:id/reset-password'") && adminRoutesJs.includes("DEFAULT_RESET_PASSWORD = '123456'") && adminRoutesJs.includes('hashPassword(DEFAULT_RESET_PASSWORD)'), 'admin routes should reset user passwords to 123456 using bcrypt');
assert(adminRoutesJs.includes("router.get('/ai-settings'") && adminRoutesJs.includes("router.put('/ai-settings'") && adminRoutesJs.includes('saveAiSettings'), 'admin routes should expose AI configuration without exposing API keys');
const aiPromptsJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'ai-prompts.js'), 'utf8');
assert(settingsJs.includes("'ai.provider': 'xfyun'") && settingsJs.includes("'ai.default_model': 'xopqwen36v35b'") && settingsJs.includes("'ai.context_mode': 'recent'") && settingsJs.includes("'ai.context_recent_messages': '6'"), 'AI settings should default to Xunfei Xingchen Qwen3.6 with recent context');
assert(dbJsFinal.includes("key = 'ai.default_model'") && dbJsFinal.includes("value = 'xsparkx2flash'") && dbJsFinal.includes("xopqwen36v35b"), 'database migration should upgrade the old Xunfei default model to Qwen3.6');
assert(settingsJs.includes('AI_PROVIDER_DEFAULTS') && settingsJs.includes('XFYUN_API_KEY') && settingsJs.includes('DEEPSEEK_API_KEY'), 'AI settings should support Xunfei first and keep DeepSeek switchback');
assert(aiRoutesJs.includes('streamOpenAiCompatible') && aiRoutesJs.includes('/chat/completions') && aiRoutesJs.includes('stream: true'), 'AI route should call OpenAI-compatible chat completions with streaming enabled');
assert(aiRoutesJs.includes("settings.provider === 'xfyun'") && aiRoutesJs.includes('enable_thinking = false'), 'Xunfei streaming should disable reasoning output so the UI receives assistant content directly');
assert(aiRoutesJs.includes("router.get('/sessions'") && aiRoutesJs.includes("router.post('/sessions'") && aiRoutesJs.includes("router.patch('/sessions/:id'") && aiRoutesJs.includes("router.delete('/sessions/:id'"), 'AI route should support session CRUD');
assert(aiRoutesJs.includes('ownedSession(id, req.user.id)') && aiRoutesJs.includes("WHERE session_id = ? AND user_id = ?"), 'AI route should scope sessions and messages to the current user');
assert(aiRoutesJs.includes("settings.contextMode === 'recent'") && aiRoutesJs.includes("messages.push({ role: 'user', content })"), 'AI route should support none/recent context and always append the current user message');
assert(aiRoutesJs.includes("'text/event-stream; charset=utf-8'") && aiRoutesJs.includes("sse(res, 'delta'") && aiRoutesJs.includes("sse(res, 'done'"), 'AI route should stream delta and done events to the frontend');
assert(aiRoutesJs.includes('looksLikeFullCodeRequest') && aiRoutesJs.includes('DIRECT_REFUSAL_TEMPLATE') && aiRoutesJs.includes('liteoj-direct-refusal'), 'AI route should intercept direct full-code requests without calling upstream models');
assert(!aiRoutesJs.includes('liteoj-problem-statement-guard'), 'AI route should not hard-block normal pasted problem statements');
assert(aiRoutesJs.includes('sanitizeFullCodeOutput') && aiRoutesJs.includes('liteoj-output-sanitized'), 'AI route should hide complete code blocks while preserving the rest of the reply');
assert(aiRoutesJs.includes("sse(res, 'stage'") && aiRoutesJs.includes('用户请求分析中') && aiRoutesJs.includes('小轻思考中') && aiRoutesJs.includes('小轻回复审查中'), 'AI route should emit visible progress stages while buffering and reviewing replies');
assert(aiRoutesJs.includes('AI_IDENTITY_PROMPT') && aiRoutesJs.includes("settings.systemPrompt.includes('小轻')"), 'AI route should append 小轻 identity guidance for existing saved prompts');
assert(aiPromptsJs.includes('AI_IDENTITY_PROMPT') && aiPromptsJs.includes('你的名字叫小轻') && aiPromptsJs.includes('我不能直接替你写完整可提交代码') && aiPromptsJs.includes('直接给我代码') && aiPromptsJs.includes('FULL_CODE_PATTERNS'), 'AI prompt policy should include 小轻 identity and direct-code refusal patterns');
assert(aiPromptsJs.includes('HIDDEN_FULL_CODE_NOTICE') && aiPromptsJs.includes('looksLikeStudentCode') && aiPromptsJs.includes('sanitizeFullCodeOutput'), 'AI prompt policy should include deterministic code-hiding classifiers');
const sampleProblemOnly = `题目描述
给定两个整数 a 和 b，求它们的和。

输入格式
一行两个整数 a b。

输出格式
输出一个整数。

样例输入
1 2

样例输出
3`;
assert(looksLikeProblemStatementOnly(sampleProblemOnly), 'problem statement pasted without attempt should trigger teaching-mode guard');
assert(looksLikeProblemStatementOnly(`${sampleProblemOnly}\n\n\`\`\`text\n10 20\n\`\`\``), 'statement-only guard should not treat text sample fences as student code');
assert(!looksLikeProblemStatementOnly(`${sampleProblemOnly}\n我的思路是先读入两个数再相加。`), 'student attempt should not be treated as statement-only');
assert(looksLikeStudentCode('#include <bits/stdc++.h>\nusing namespace std;\nint main(){ int a,b; cin>>a>>b; cout<<a+b; }'), 'student code detector should recognize C++ attempts');
assert(looksLikeFullCodeRequest('不用解释，直接给我 AC 代码'), 'direct code request should still be detected');
assert(looksLikeFullCodeRequest('代码呢？') && looksLikeFullCodeRequest('发给我代码') && looksLikeFullCodeRequest('没有具体实现吗？') && looksLikeFullCodeRequest('来点能直接提交的东西'), 'direct code intent detector should catch common evasive phrasings');
assert(violatesFullCodePolicy('```cpp\n#include <bits/stdc++.h>\nusing namespace std;\nint main(){\n  int a,b;\n  cin>>a>>b;\n  cout<<a+b<<\"\\n\";\n  return 0;\n}\n```', 12), 'output guard should block complete C++ programs');
assert(!violatesFullCodePolicy('可以先写一个小片段：`sum += x;`，再手动检查样例。', 12), 'output guard should allow tiny local snippets');
const sanitizedAiOutput = sanitizeFullCodeOutput('思路是先读入两个数再相加。\n```cpp\n#include <bits/stdc++.h>\nusing namespace std;\nint main(){\n  int a,b;\n  cin>>a>>b;\n  cout<<a+b<<\"\\n\";\n  return 0;\n}\n```\n你可以自己试着补全。', 12);
assert(sanitizedAiOutput.content.includes('思路是先读入两个数再相加') && sanitizedAiOutput.content.includes('隐藏完整代码') && sanitizedAiOutput.content.includes('你可以自己试着补全'), 'output sanitizer should preserve explanation and hide only the full code block');
assert(!sanitizedAiOutput.content.includes('#include'), 'output sanitizer should remove complete program text');
assert(authJs.includes('SELECT id, username, role FROM users WHERE id = ?'), 'auth should validate token user still exists before using foreign-keyed user_id');
assert(authJs.includes('JWT_SECRET must be set to a strong random value in production'), 'production should reject missing or weak JWT_SECRET');
assert(authJs.includes('clearAuthCookie(req, res)'), 'stale login cookie should be cleared with request-aware cookie attributes');
assert(authJs.includes("res.cookie(COOKIE_NAME, 'deleted'") && authJs.includes('httpOnly: true') && authJs.includes('if (cookieSecure(req)) options.secure = true'), 'auth cookie clearing should use valid request-aware HttpOnly/Secure attributes');
const judgeRouteJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'judge.js'), 'utf8');
assert(judgeRouteJs.includes('JUDGE_TOKEN must be set to a strong random value in production'), 'production should reject missing or weak JUDGE_TOKEN');
assert(judgeRouteJs.includes('JUDGE_LOCK_TIMEOUT_SECONDS') && judgeRouteJs.includes('reclaimStaleJudging'), 'judge queue should reclaim stale Judging submissions');
assert(judgeRouteJs.includes("router.get('/cases/:caseId/:kind'") && judgeRouteJs.includes('inputPath: c.input_path') && !judgeRouteJs.includes('readDataFile(c.input_path)'), 'judge acquire should return case metadata and stream test data by case');
assert(judgeRouteJs.includes('stale judge result ignored') && judgeRouteJs.includes("status = 'Judging'") && judgeRouteJs.includes('judge_id = ?'), 'judge result writes should be bound to the active judge lock');
const composeYaml = fs.readFileSync(path.join(__dirname, '..', 'docker-compose.yml'), 'utf8');
assert(composeYaml.includes('profiles:') && composeYaml.includes('container-judge'), 'container judge should be behind an explicit compose profile');
assert(composeYaml.includes('JWT_SECRET:?') && composeYaml.includes('JUDGE_TOKEN:?') && composeYaml.includes('ADMIN_PASSWORD:?'), 'compose should require production secrets');
assert(composeYaml.includes('network: ${DOCKER_BUILD_NETWORK:-host}'), 'docker build should use host network by default for domestic cloud/router environments');
assert(composeYaml.includes('HOST: 0.0.0.0'), 'compose should make the app listen inside the container while publishing only loopback on the host');
assert(composeYaml.includes('127.0.0.1:${PORT:-3000}:3000'), 'compose should bind the web port to loopback for reverse-proxy deployments');
assert(composeYaml.includes('XFYUN_API_KEY: ${XFYUN_API_KEY:-}') && composeYaml.includes('DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY:-}'), 'compose should pass AI provider API keys only to the backend container');
assert(composeYaml.includes('go-judge:') && composeYaml.includes('Dockerfile.go-judge') && composeYaml.includes('127.0.0.1:${GO_JUDGE_PORT:-5050}:5050'), 'compose should include a loopback-bound go-judge service');
assert(composeYaml.includes('JUDGE_MAX_OUTPUT_BYTES: ${JUDGE_MAX_OUTPUT_BYTES:-16777216}'), 'compose should use the widened judge output limit by default');
const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
const dockerignore = fs.readFileSync(path.join(__dirname, '..', '.dockerignore'), 'utf8');
assert(dockerfile.includes('fetch-retries 5') && dockerfile.includes('registry.npmjs.org') && dockerfile.includes('npm ci --omit=dev'), 'Dockerfile npm install should use retries and fallback registries');
const goJudgeDockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile.go-judge'), 'utf8');
const goJudgeMount = fs.readFileSync(path.join(__dirname, '..', 'judge', 'mount.yaml'), 'utf8');
assert(goJudgeDockerfile.includes('GO_JUDGE_VERSION=1.12.0') && goJudgeDockerfile.includes('/opt/go-judge -version') && !goJudgeDockerfile.includes('criyle/go-judge'), 'go-judge Dockerfile should use prepared release binaries instead of Docker Hub base images');
assert(goJudgeDockerfile.includes('source=.runtime/go-judge/go-judge') && goJudgeDockerfile.includes('Using pre-downloaded go-judge binary'), 'go-judge Dockerfile should prefer the host-prepared binary from the build context');
assert(goJudgeDockerfile.includes('gcc g++') && goJudgeDockerfile.includes('python3') && goJudgeDockerfile.includes('-http-addr'), 'go-judge Dockerfile should install language toolchains and expose HTTP mode');
assert(goJudgeMount.includes('workDir: /w') && goJudgeMount.includes('source: /usr') && goJudgeMount.includes('uid: 1536'), 'go-judge mount configuration should provide compiler/runtime paths and an unprivileged container user');
assert(dockerignore.includes('!.runtime/go-judge/go-judge'), 'dockerignore should allow the prepared go-judge binary into the build context');
const oneClickScript = fs.readFileSync(path.join(__dirname, '..', 'start.sh'), 'utf8');
const deployEnvScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deploy', 'env.sh'), 'utf8');
const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
const deployServiceScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deploy', 'services.sh'), 'utf8');
const deployDockerScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deploy', 'docker.sh'), 'utf8');
const deployDataScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deploy', 'data.sh'), 'utf8');
assert(oneClickScript.includes('scripts/deploy/services.sh'), 'start.sh should source modular deployment scripts');
assert(oneClickScript.includes('scripts/deploy/data.sh') && oneClickScript.includes('backup) backup_all') && oneClickScript.includes('restore) restore_all') && oneClickScript.includes('data-volume) print_data_volume'), 'start.sh should expose script-based backup, restore, and volume inspection actions');
assert(!deployServiceScript.includes('JUDGE_EXECUTOR') && deployServiceScript.includes('GO_JUDGE_URL') && deployServiceScript.includes('GO_JUDGE_PROCESS_LIMIT') && deployServiceScript.includes('SPJ_TIMEOUT_MS') && deployServiceScript.includes('SPJ_MEMORY_LIMIT_MB') && deployServiceScript.includes('compose up -d --build app go-judge'), 'one-click script should start web plus go-judge and point the host judge worker at go-judge only');
assert(deployDataScript.includes('resolve_data_volume') && deployDataScript.includes('liteoj-app') && deployDataScript.includes('/app/data') && deployDataScript.includes('compose config --format json'), 'data script should resolve the real Compose data volume instead of relying on a hard-coded volume name');
assert(deployDataScript.includes('backup_all()') && deployDataScript.includes('restore_all()') && deployDataScript.includes('find /data -mindepth 1') && deployDataScript.includes('tar xzf'), 'data script should provide backup and destructive restore operations');
assert(deployServiceScript.includes('ensure_web_port_available') && deployServiceScript.includes('LITEOJ_AUTO_PORT'), 'start script should auto-select a free web port when the default port is occupied');
assert(deployServiceScript.includes('ensure_go_judge_port_available') && deployServiceScript.includes('LITEOJ_GO_JUDGE_PORT_SCAN_END'), 'start script should auto-select a free go-judge port when 5050 is occupied');
assert(deployServiceScript.includes('/dev/tcp/127.0.0.1/$port'), 'port detection should also probe loopback so WSL/Docker Desktop notices Windows-side listeners');
assert(deployEnvScript.includes('ADMIN_USERNAME=admin') && deployEnvScript.includes('ADMIN_PASSWORD=admin123'), 'one-click script should initialize the configured admin account');
assert(deployEnvScript.includes('JUDGE_MAX_OUTPUT_BYTES=16777216') && deployEnvScript.includes('set_env_key JUDGE_MAX_OUTPUT_BYTES 16777216'), 'one-click script should initialize and upgrade the widened judge output limit');
assert(deployServiceScript.includes('JUDGE_MAX_OUTPUT_BYTES=$(quote "${JUDGE_MAX_OUTPUT_BYTES:-16777216}")'), 'host judge worker should use the widened output limit by default');
assert(deployEnvScript.includes('CHECKER_SOURCE_LIMIT=1') && deployEnvScript.includes('SPJ_TIMEOUT_MS=3000') && deployEnvScript.includes('SPJ_MEMORY_LIMIT_MB=256'), 'one-click script should initialize Special Judge limits');
assert(deployEnvScript.includes('JUDGE_LOCK_TIMEOUT_SECONDS=600') && deployEnvScript.includes('MAX_CODE_SIZE_KB=128') && deployEnvScript.includes('MAX_JUDGE_QUEUE=500'), 'one-click script should initialize judge reliability and submission quota limits');
assert(deployEnvScript.includes('XFYUN_API_KEY=') && deployEnvScript.includes('ensure_plain_key XFYUN_API_KEY') && deployEnvScript.includes('DEEPSEEK_API_KEY=') && deployEnvScript.includes('ensure_plain_key DEEPSEEK_API_KEY'), 'one-click script should create empty AI API key placeholders for server-side calls');
assert(envExample.includes('XFYUN_API_KEY=') && envExample.includes('DEEPSEEK_API_KEY='), '.env.example should document server-side AI API key placeholders');
assert(deployEnvScript.includes('ensure_plain_key ADMIN_USERNAME admin') && deployEnvScript.includes('is_placeholder "$(env_value ADMIN_PASSWORD)"'), 'one-click script should not reset existing admin credentials on every start');
assert(deployServiceScript.includes('start_judge()') && deployServiceScript.includes('judge/worker.js'), 'one-click script should start a host judge worker');
assert(deployDockerScript.includes('mirrors.tuna.tsinghua.edu.cn/docker-ce') && deployDockerScript.includes('docker.1ms.run') && deployDockerScript.includes('Preparing base image debian:bookworm-slim') && deployDockerScript.includes('prepare_go_judge_binary'), 'deployment should prefer domestic Docker apt/registry mirrors and prepare go-judge outside Docker Hub mirrors');

const seedProblemJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'problems', 'P1001', 'problem.json'), 'utf8'));
assert(!seedProblemJson.description.includes('数学公式示例') && !seedProblemJson.description.includes('a^2+b^2'), 'seed A+B problem should not include unrelated math formula examples');
assert(seedProblemJson.description.includes('$a$') && seedProblemJson.description.includes('$b$') && seedProblemJson.description.includes('$a+b$'), 'seed A+B problem should keep formulas related to the statement itself');
assert.deepStrictEqual(seedProblemJson.tags, ['simulation'], 'seed A+B problem should only keep the simulation slug');
const initJs = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'init.js'), 'utf8');
const resetAdminJs = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'reset-admin.js'), 'utf8');
assert(initJs.includes('shouldRefreshSample') && initJs.includes('数学公式示例') && initJs.includes("raw.id === 'P1001'") && initJs.includes("existingTags === '[]'"), 'init should refresh stored P1001 statement/tags when rerun');
assert(initJs.includes("DEFAULT_ADMIN_USERNAME = 'admin'") && initJs.includes("DEFAULT_ADMIN_PASSWORD = 'admin123'"), 'init should use the configured default admin credentials');
assert(initJs.includes('hashPassword(password)') && !initJs.includes('bcrypt.hashSync'), 'init should use centralized bcrypt password helpers');
assert(initJs.includes('Admin seed skipped; existing admin user') && initJs.includes("UPDATE users SET role = 'admin'"), 'init should not reset existing admin passwords and should recover databases without an admin');
assert(initJs.includes('ADMIN_PASSWORD must be at least 6 characters'), 'initial admin password should follow the shared minimum length rule');
assert(initJs.includes('WHERE paper_id = ? AND section = ? AND number = ?'), 'prelim seed refresh should not overwrite groups from other sections with the same local number');
assert(resetAdminJs.includes('existingTarget') && resetAdminJs.includes("UPDATE users SET password_hash = ?, role = 'admin'") && resetAdminJs.includes('existingAdmin'), 'admin reset should handle an existing target username before renaming another admin');

const routes = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'problems.js'), 'utf8');
const problemFilesJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'problem-files.js'), 'utf8');
const goJudgeClientJs = fs.readFileSync(path.join(__dirname, '..', 'judge', 'go-judge-client.js'), 'utf8');
assert(goJudgeClientJs.includes('16 * 1024 * 1024'), 'go-judge client should default to a 16 MiB output collection limit');
assert(routes.includes('TESTDATA_UNZIPPED_LIMIT') && routes.includes('测试数据解压后总大小不能超过'), 'zip upload should limit total uncompressed testdata size');
assert(routes.includes('ATTACHMENT_FILE_LIMIT') && routes.includes('multer.diskStorage') && routes.includes("'.zip'"), 'problem attachments should support bounded disk-backed download files');
assert(routes.includes('MANUAL_CASE_LIMIT') && routes.includes('PROBLEM_STORAGE_LIMIT') && routes.includes('assertProblemStorage'), 'problem testdata and attachments should enforce per-problem storage quotas');
assert(routes.includes('MAX_CODE_SIZE_KB') && routes.includes('SUBMIT_RATE_LIMIT') && routes.includes('MAX_PENDING_SUBMISSIONS_PER_USER') && routes.includes('MAX_JUDGE_QUEUE'), 'code submission should enforce size, frequency, user queue, and global queue limits');
assert(routes.includes('tempAttachmentFileName') && routes.includes('contentDispositionAttachment'), 'problem attachments should use random temporary names and stable download names');
assert(problemFilesJs.includes('function sanitizeAttachmentFileName') && !problemFilesJs.includes('return `${Date.now()}_'), 'attachment final filenames should preserve the uploaded basename instead of adding random prefixes');
assert(routes.includes("['publish', 'public', 'show']") && routes.includes("['hide', 'hidden']"), 'problem batch visibility actions should accept configured action aliases');
assert(routes.includes('copyAttachmentsAndRewriteDescription'), 'clone should copy and rewrite attachment URLs');
for (const route of ["router.patch('/:id/status'", "router.post('/:id/status'", "router.post('/:id/clone'", "router.post('/:id/attachments'", "router.get('/:id/attachments/:filename'", "router.get('/:id/checker'", "router.post('/:id/checker'", "router.delete('/:id/checker'", "router.delete('/:id'", "router.get('/:id/cases'", "router.get('/:id/cases/download'", "router.get('/:id/cases/:caseId'", "router.post('/:id/cases'", "router.post('/:id/cases/zip'", "router.put('/:id/cases/bulk'", "router.delete('/:id/cases'", "router.delete('/:id/cases/:caseId'", "router.post('/:id/rejudge'", "router.post('/:id/submit'"]) {
  assert(routes.includes(route), `missing backend route ${route}`);
}
assert(routes.includes('addCaseFileToZip') && routes.includes('selectProblemCases') && routes.includes('selected-testdata'), 'problem routes should support all/selected testdata zip downloads');
assert(appJs.includes('raw.replace(/\\\\\\\((.+?)\\\\\\\)/g') || appJs.includes('raw.replace(/\\\\\((.+?)\\\\\)/g'), 'inline markdown should support \\(...\\) KaTeX math');
assert(appJs.includes('text.replace(/\\\\\\\[([\\s\\S]*?)\\\\\\\]/g') || appJs.includes('text.replace(/\\\\\[([\\s\\S]*?)\\\\\]/g'), 'markdown should support \\[...\\] display math');
assert(!appJs.includes('readAsDataURL'), 'Markdown image upload must not inline base64 data URLs');
assert(appJs.includes('isMarkdownTableAlignRow') && appJs.includes('rowspan=') && appJs.includes("String(text).trim() === '^'"), 'Markdown table renderer should support alignment rows and ^ vertical merges');
assert(appJs.includes('colLast: index === colCount - 1') && appJs.includes("classes.push('col-last')"), 'Markdown table renderer should mark the logical last column so rowspans do not break borders');
assert(appJs.includes('normalizeBrokenMarkdownLinks') && appJs.includes('cuteTableWrapperClass') && appJs.includes('md-align'), 'Markdown renderer should support split image links plus :::align and ::cute-table directives');
assert(appJs.includes('function isMarkdownHorizontalRule') && appJs.includes('<hr class="md-hr" />'), 'Markdown renderer should display --- separators as horizontal rules');
assert(appJs.includes('data-md-attachment') && appJs.includes('insertAttachmentIntoEditor'), 'Markdown toolbar should upload non-image attachments and insert links');
assert(appJs.includes('tag-search-input') && appJs.includes('tag-check-option') && appJs.includes('data-tag-search') && appJs.includes('type="checkbox" name="tags"'), 'problem editor should use searchable checkbox tag selection');
assert(appJs.includes('tag-selected-box') && appJs.includes('updateSelectedTagBox') && appJs.includes('data-remove-tag'), 'problem editor should show and maintain selected tag chips');
assert(!appJs.includes(' · ${esc(meta)}'), 'problem tag selector should not show level suffixes such as · topic');
const styleCss = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'style.css'), 'utf8');
assert(styleCss.includes('.container.ai-container') && styleCss.includes('position: sticky') && styleCss.includes('height: calc(100vh - 108px)') && styleCss.includes('.ai-welcome-card'), 'AI page CSS should widen 小轻 and keep history/composer independent from message scrolling');
assert(styleCss.includes('.ai-loading') && styleCss.includes('@keyframes ai-spin'), 'AI page CSS should show loading stages with a spinner');
assert(styleCss.includes('border-radius: 28px') && styleCss.includes('box-shadow: 0 18px 42px') && styleCss.includes('backdrop-filter: blur(12px)'), 'AI composer should render as a rounded floating bottom bar');
assert(styleCss.includes('.table-action-row'), 'management table buttons should use an inner flex row so td borders stay aligned');
assert(styleCss.includes('td.actions.table-actions'), 'compatibility table action td should remain a table-cell, not a flex row');
assert(styleCss.includes('.pagination-bar') && styleCss.includes('.page-size-control'), 'stylesheet should define the shared pagination bar and page-size selector');
assert(styleCss.includes('.manage-problem-table .table-action-row { flex-wrap: nowrap') && styleCss.includes('.prelim-admin-overview-table'), 'admin tables should keep dense non-wrapping action layouts on desktop');
assert(styleCss.includes('.filter-panel-card') && styleCss.includes('.filter-panel-grid'), 'shared filter panel classes should be project-owned semantic names');
assert(!outsideUiNamePattern.test(styleCss) && !cssModuleNamePattern.test(styleCss), 'stylesheet should not keep external-looking class names or comments');
assert(styleCss.includes('.button-row'), 'button rows should use shared spacing class');
assert(styleCss.includes('-webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);'), 'fixed header should list -webkit-backdrop-filter before backdrop-filter');
assert(styleCss.includes('-webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);'), 'editor footer should include Safari backdrop-filter prefix');
assert(styleCss.includes('.tag-check-list') && styleCss.includes('.tag-search-input') && styleCss.includes('.align-center'), 'stylesheet should support tag checkbox search and Markdown table alignment');
assert(styleCss.includes('.md-align-center') && styleCss.includes('.md-cute-table'), 'stylesheet should support custom Markdown alignment and cute table rendering');
assert(styleCss.includes('.markdown .md-hr') && styleCss.includes('linear-gradient(90deg'), 'stylesheet should render Markdown horizontal rules softly');
assert(styleCss.includes('.md-table .col-last') && !styleCss.includes('.md-table th:last-child') && !styleCss.includes('.md-table tr:last-child td'), 'Markdown table borders should be based on logical columns and keep the closing bottom line');
assert(appJs.includes('function enhanceFormAccessibility') && appJs.includes('ensureControlId') && appJs.includes('aria-label'), 'dynamic forms should be normalized with id/name/label accessibility helpers');

assert(appJs.includes("routeLink('/admin/problem/new', '新增题目'"), 'admin new-problem entry should be a real link, not a fragile inline-only button');
assert(appJs.includes("routeLink(`/admin/problem/${problemUrl(p.id)}/edit`, '编辑'"), 'problem manage edit action should be a real link');
assert(appJs.includes("routeLink(`/admin/problem/${problemUrl(p.id)}/data`, '数据'"), 'problem manage data action should be a real link');
assert(appJs.includes('case-delete-btn') && appJs.includes('data-problem-id=') && appJs.includes("btn.addEventListener('click', () => deleteCase"), 'case delete buttons should use stable data attributes and explicit event binding');
assert(appJs.includes('async function deleteCase') && appJs.includes('window.deleteCase = deleteCase'), 'deleteCase should be both locally callable and globally exported');
assert(appJs.includes('downloadAllCasesBtn') && appJs.includes('downloadSelectedCasesBtn') && appJs.includes('deleteSelectedCasesBtn') && appJs.includes("problemApi(problemId, `/cases/download${query}`)"), 'case manager should expose all/selected testdata download and selected delete actions');
assert(appJs.includes('formatMemoryKb') && appJs.includes('<th>内存</th>') && appJs.includes('routeAnchor(`/problem/${problemUrl(s.problemId)}`'), 'submission pages should show memory and link back to the problem');
assert(styleCss.includes('a.btn') && styleCss.includes('.table-action-row .btn'), 'link-style action buttons should share the same UI as normal buttons');
const submissionsRoutes = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'submissions.js'), 'utf8');
assert(submissionsRoutes.includes('const requestedLimit') && submissionsRoutes.includes('COUNT(*) AS count') && submissionsRoutes.includes('LIMIT ? OFFSET ?'), 'submission list API should support server-side pagination');

assert(!/td\s*\{[^}]*display\s*:\s*flex/i.test(styleCss), 'plain td must not be flex because it breaks table borders');
assert(!/td\.[^{]+\{[^}]*display\s*:\s*flex/i.test(styleCss), 'table action td must not be flex because it breaks row borders');
assert(indexHtml.includes('data-route="/admin"') && !indexHtml.includes('onclick="nav(\'/admin\')'), 'navbar should use delegated SPA data-route navigation');

for (const text of [
  'data-route=',
  "event.target.closest('[data-route]')",
  "document.addEventListener('click'",
  "btn.addEventListener('click', () => deleteCase(btn.dataset.problemId || problemId, btn.dataset.caseId))"
]) {
  assert(appJs.includes(text), `frontend missing stable SPA action marker: ${text}`);
}
assert(!appJs.includes('onclick="event.preventDefault(); nav(this.dataset.route)'), 'routeLink must not rely on inline onclick handlers');
assert(!appJs.includes('href="javascript:nav('), 'SPA links must not use fragile javascript: href routes');
assert(!appJs.includes('onclick="deleteCase('), 'case delete must not use duplicated inline onclick handlers');
assert(appJs.includes('PROBLEM_ROUTE_PATTERN') && appJs.includes('(?:T\\\\d+)?'), 'frontend problem routes should accept CSPJ25T1-style ids');
assert(appJs.includes('return await renderProblemEditor(m[1]);') || appJs.includes('return renderProblemEditor(m[1]);'), 'new-problem route should dispatch to renderProblemEditor');
assert(appJs.includes('return await renderCaseManager(m[1]);') || appJs.includes('return renderCaseManager(m[1]);'), 'testdata route should dispatch to renderCaseManager');
assert(appJs.includes("function jsArg(value)") && appJs.includes("replace(/'/g,"), 'frontend should keep a dedicated string escaper for inline JS arguments');
assert(!appJs.includes("return JSON.stringify(String(value ??"), 'inline JS string arguments should not break double-quoted onclick attributes');
assert(appJs.includes("onclick=\"rejudgeProblem(${jsArg(p.id)})\""), 'problem page should render the rejudge button with a safely quoted problem id');
assert(appJs.includes("const url = isNew ? '/api/problems' : problemApi(existingProblem.id)"), 'problem editor should PUT updates to the original id so the id itself can change');
assert(appJs.includes('async function saveProblemEditor') && appJs.includes("const method = isNew ? 'POST' : 'PUT'") && appJs.includes("const url = isNew ? '/api/problems' : problemApi(existingProblem.id)"), 'problem editor save should distinguish create/update and allow id changes');

const dbJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'db.js'), 'utf8');
for (const col of [
  "ensureColumn('problems', 'description'",
  "ensureColumn('problems', 'tags_json'",
  "ensureColumn('problems', 'time_limit'",
  "ensureColumn('problems', 'checker_mode'",
  "ensureColumn('problem_cases', 'subtask'",
  "ensureColumn('problem_cases', 'time_limit'",
  "ensureColumn('problem_cases', 'memory_limit'",
  "ensureColumn('submissions', 'optimize'",
]) {
  assert(dbJs.includes(col), `database migration missing ${col}`);
}
assert(!appJs.includes('SCORING_MODES') && !appJs.includes('name="scoringMode"') && !appJs.includes('name="checkerMode"') && appJs.includes('name="specialJudge"') && appJs.includes('name="subtask"'), 'frontend should expose Special Judge and subtask controls without OI/ACM scoring modes or legacy checker mode select');
const runnerJs = fs.readFileSync(path.join(__dirname, '..', 'judge', 'runner.js'), 'utf8');
assert(fs.existsSync(path.join(__dirname, '..', 'judge', 'testlib.h')), 'vendored testlib.h should be available for Special Judge checker compilation');
assert(!fs.existsSync(path.join(__dirname, '..', 'judge', 'sandbox.js')), 'legacy local sandbox implementation should be removed');
assert(!runnerJs.includes('child_process') && !runnerJs.includes('JUDGE_EXECUTOR') && !runnerJs.includes('runProcess') && runnerJs.includes('createGoJudgeExecution') && runnerJs.includes('compileChecker') && runnerJs.includes('runChecker'), 'judge runner should use go-judge as the only execution backend, including Special Judge');
assert(runnerJs.includes('async function readCaseContent') && runnerJs.includes('/api/judge/cases/${test.id}/${kind}') && runnerJs.includes('safeRelativePath'), 'judge runner should read test data by case instead of relying on acquire JSON payloads');
const docsText = [
  'README.md',
  'docs/ARCHITECTURE.md',
  'docs/DEPLOYMENT.md',
  'docs/DEVELOPMENT.md',
  'docs/USER_MANUAL.md',
  'docs/FINAL_REVIEW.md',
].map((file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
assert(docsText.includes('Special Judge') && docsText.includes('checker.cpp') && docsText.includes('go-judge') && docsText.includes('SPJ_TIMEOUT_MS'), 'documentation should cover go-judge, Special Judge, checker.cpp, and SPJ deployment limits');
assert(docsText.includes('::cute-table') && docsText.includes(':::align') && docsText.includes('清空 Docker 数据'), 'documentation should cover custom problem Markdown directives and Docker data cleanup');
assert(!docsText.includes('liteoj.sh') && !docsText.includes('浮点误差比较') && !docsText.includes('输出比较配置'), 'documentation should not keep retired launcher or legacy compare-mode wording');

console.log('Smoke tests passed: programming problems, go-judge execution, and CSP preliminary question bank logic look consistent.');
