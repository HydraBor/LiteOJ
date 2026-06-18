const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  parseProblemCode,
  compareProblemCode,
  sortProblems,
} = require('../backend/problem-utils');
const { parsePaperQuestions, normalizeGroupName } = require('../backend/prelim-utils');
const { compareOutput } = require('../judge/checker');
const { applyScoring, normalizeExecutorMode } = require('../judge/runner');

function ids(list) { return list.map((x) => x.id); }

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
assert.strictEqual(packageJson.version, '1.3.0', 'package version should be 1.3.0 after judge system upgrade');
assert(!('sync-cutoffs' in packageJson.scripts), 'retired cutoff synchronization script should not remain in package scripts');
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
assert(deploymentDoc.includes('Docker Hub 超时处理') && deploymentDoc.includes('node:22-bookworm-slim'), 'deployment docs should include Docker Hub timeout recovery');
const dbJsFinal = fs.readFileSync(path.join(__dirname, '..', 'backend', 'db.js'), 'utf8');
assert(!dbJsFinal.includes('prelim_cutoffs'), 'final simplified analytics should not create or migrate cutoff tables');
const securityJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'security.js'), 'utf8');
const profileRoutesJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'profile.js'), 'utf8');
const passwordsJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'passwords.js'), 'utf8');
assert(securityJs.includes('X-Content-Type-Options') && securityJs.includes('Cache-Control') && securityJs.includes('staticOptions'), 'security middleware should set nosniff and cache headers');
assert(passwordsJs.includes('bcrypt') && passwordsJs.includes('hashPassword') && passwordsJs.includes('verifyPassword'), 'password helper should centralize bcrypt hashing and verification');
assert(profileRoutesJs.includes("router.post('/password'") && profileRoutesJs.includes('requireLogin') && profileRoutesJs.includes('hashPassword'), 'profile route should support logged-in password changes');


assert.strictEqual(parseProblemCode('P1001'), 'P1001');
assert.strictEqual(parseProblemCode('ABC12'), 'ABC12');
assert.strictEqual(parseProblemCode('p1001'), null);
assert.strictEqual(parseProblemCode('1001'), null);
assert.strictEqual(parseProblemCode('P-1001'), null);
assert.strictEqual(parseProblemCode('P1001A'), null);
assert.deepStrictEqual(['P10', 'ABC10', 'ABC2', 'B1', 'P1'].sort(compareProblemCode), ['ABC2', 'ABC10', 'B1', 'P1', 'P10']);
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
const subtaskScore = applyScoring([
  { caseId: 1, subtask: 's1', status: 'Accepted', rawScore: 30, score: 0 },
  { caseId: 2, subtask: 's1', status: 'Wrong Answer', rawScore: 30, score: 0 },
  { caseId: 3, subtask: 's2', status: 'Accepted', rawScore: 40, score: 0 },
], 'oi');
assert.strictEqual(subtaskScore.status, 'Partially Accepted', 'subtask scoring should keep partial status');
assert.strictEqual(subtaskScore.score, 40, 'failed subtask should award zero for every case in the group');
const acmScore = applyScoring([
  { caseId: 1, status: 'Accepted', rawScore: 50, score: 0 },
  { caseId: 2, status: 'Wrong Answer', rawScore: 50, score: 0 },
], 'acm');
assert.strictEqual(acmScore.score, 0, 'ACM scoring should be all-or-nothing');
assert.strictEqual(normalizeExecutorMode('gojudge'), 'go-judge', 'gojudge executor alias should normalize');
assert.strictEqual(normalizeExecutorMode('go-judge'), 'go-judge', 'go-judge executor should normalize');
assert.strictEqual(normalizeExecutorMode('docker'), 'local', 'legacy sandbox names should stay under local executor');

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
assert.deepStrictEqual(parsedPrelim.questions.find((q) => q.number === 1).tags.map((t) => t.name), ['位字节', '数据类型'], 'question 1 tag wording should be 位字节 + 数据类型');
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
assert(analyticsRoutes.includes('examPointCount') && analyticsRoutes.includes('knowledgeCount'), 'analytics summary should expose current exam-point count while keeping compatibility');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'app.js'), 'utf8');
const outsideUiNamePattern = new RegExp(['hy', 'dro', '|', 'ac', 'go'].join(''), 'i');
const cssModuleNamePattern = /[A-Za-z]+_[A-Za-z0-9]+__/;

assert(appJs.includes('analyticsYearDropdown') && appJs.includes('analyticsGroupSelect'), 'frontend analytics should use a compact year dropdown and select-style group filter');
assert(appJs.includes('compact-analytics-filter') && appJs.includes('filter-panel-grid') && !appJs.includes('analytics-filter-field') && !appJs.includes('page-head analytics-head'), 'analytics filter should follow the shared filter panel grid instead of custom field wrappers or page head');
assert(!appJs.includes('按年份和组别统计初赛题库中的知识点出现次数与加权分值贡献。') && !appJs.includes("routeLink('/prelim', '返回初赛题库'") && !appJs.includes('<h1>数据分析</h1>'), 'analytics page should remove redundant title, explanatory text, and return link');
assert(appJs.includes('考点出现次数') && appJs.includes('考点加权分值') && appJs.includes('考点/年份对照表') && !appJs.includes('知识点出现次数') && !appJs.includes('知识点加权分值') && !appJs.includes('知识点/年份对照表'), 'analytics page should use 考点 wording');
assert(!appJs.includes('<h1>后台管理</h1>') && !appJs.includes('<h1>个人主页</h1>') && !appJs.includes('查看账号信息并修改登录密码。') && !appJs.includes('密码会使用 bcrypt 单向哈希存储'), 'admin/profile pages should not render removed headings or password storage hint');
assert(appJs.includes('analyticsCountBarChart') && appJs.includes('analyticsDonutChart') && appJs.includes('analyticsYearCompare'), 'frontend analytics should render count bar chart, weighted donut chart, and year comparison table');
assert(!appJs.includes("tag: '其他'") && !appJs.includes("tag: \"其他\""), 'analytics weighted donut should expand all exam points instead of merging them into 其他');
assert(!appJs.includes('/api/analytics/prelim/cutoffs') && !appJs.includes('name="province"'), 'frontend analytics should not load cutoff lines or render province filters in the simplified version');
assert(!outsideUiNamePattern.test(appJs) && !cssModuleNamePattern.test(appJs), 'frontend templates should use LiteOJ-owned semantic class names');
for (const fn of ['editProblem', 'openProblemData', 'toggleProblem', 'cloneProblem', 'deleteProblem', 'deleteCase', 'rejudgeProblem']) {
  assert(appJs.includes(`window.${fn}`), `missing ${fn}`);
}
for (const text of ['renderPrelimList', 'renderPrelimItem', 'renderPrelimAdmin', 'renderPrelimImport', 'renderMockHome', 'renderMockExam', 'renderMockReport', 'prelimOption', 'shouldShowPrelimGroupStem', 'sectionTitleFromGroups', 'numberedStem', 'questionScoreInline', 'questionPaperStem', 'renderMockExamSections', 'renderMockReportSections', 'formatScore', 'bindMockOptionEvents', 'mock-option-input', 'subquestion-meta', 'bindProblemManageActions', 'data-problem-action=\"toggle\"', 'data-problem-action=\"clone\"', 'problemCreateCaseSection', 'highlightCode', 'uploadProblemAttachment', 'currentProblemIdForAttachment']) {
  assert(appJs.includes(text), `frontend missing ${text}`);
}

assert(!appJs.includes('CSP-J/S 初赛模考'), 'mock home should not show redundant banner title');
assert(!appJs.includes('自动从初赛题库组卷'), 'mock home should not show redundant explanatory text');
assert(!appJs.includes('mock-tabs'), 'mock home should not render redundant tab switcher');
assert(appJs.includes('label class="mock-keyword">关键词'), 'mock filter keyword input should have a visible label');

assert(/function\s+attrEsc\s*\(/.test(appJs), 'Markdown editor toolbar should define attrEsc before renderProblemEditor uses it');
assert(appJs.includes('encodeURIComponent(String(value ??') && appJs.includes('decodeURIComponent(value ||'), 'Markdown toolbar insertion values should be safely encoded/decoded for data attributes');
assert(!appJs.includes('href="javascript:nav('), 'SPA routes should not use fragile javascript:nav hrefs');

assert(!appJs.includes('进入最新试卷'), 'prelim list should not show latest paper shortcut');
assert(!appJs.includes('程序阅读题和代码补全题按整题展示'), 'prelim list should not show redundant explanatory text');
assert(!appJs.includes('<h1>初赛题库</h1>'), 'prelim list should not show redundant page hero title');
assert(!appJs.includes('<label>作答'), 'prelim filter should not show retired answer/question-type filter');
assert(!appJs.includes("const keys = ['keyword','year','groupName','section','questionType'") && !appJs.includes('name="questionType"'), 'prelim filter should not send retired questionType query');
assert(appJs.includes('prelim-filter-card'), 'prelim list should start with a clean filter card');
assert(!appJs.includes('第 ${q.number} 题${questionScoreInline(q)}') && !appJs.includes('第 ${item.firstQuestionNumber || item.number} 题${questionScoreInline(item)}'), 'prelim list titles should not duplicate the score after the question number');
assert(appJs.includes('class="prelim-type-cell"') && appJs.includes('class="prelim-type-chip"'), 'prelim list should use non-wrapping type chips');
assert(!appJs.includes('esc(item.paperTitle'), 'prelim list and item header should not repeat the paper title under each item');
assert(appJs.includes('window.startMockExam = async'), 'mock start handler should be exported correctly');

assert(appJs.includes('/logo-mark.svg'), 'auth page should use the SVG LiteOJ mark');
assert(appJs.includes('async function renderProfile') && appJs.includes('/api/profile/password') && appJs.includes("path === '/profile'"), 'frontend should provide a profile page for password changes');
assert(appJs.includes("routeAnchor('/profile'"), 'logged-in user box should link to the profile page');
assert(!appJs.includes('<h1>提交记录</h1>'), 'submissions page should not render a redundant page title');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'index.html'), 'utf8');
assert(indexHtml.includes('/logo.svg'), 'index.html should apply the full logo');
assert(indexHtml.includes('/logo-mark.svg'), 'index.html should apply the favicon mark');
assert(fs.existsSync(path.join(__dirname, '..', 'frontend', 'public', 'logo.svg')), 'full logo SVG should exist');
assert(fs.existsSync(path.join(__dirname, '..', 'frontend', 'public', 'logo-mark.svg')), 'logo mark SVG should exist');
const logoMark = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'logo-mark.svg'), 'utf8');
assert(logoMark.includes('fill="white"'), 'selected logo mark should use a white L');
assert(!logoMark.includes('lightning') && !logoMark.includes('bolt'), 'selected logo mark should be the clean L version, not the lightning concept');


for (const endpoint of ["'/status'", "'/clone'", "'/rejudge'", "'/cases/zip'", "'/attachments'"]) {
  assert(appJs.includes(endpoint), `frontend does not reference ${endpoint}`);
}
assert(appJs.includes("problemApi(problemId, '/cases')") && appJs.includes('renderCaseOverview') && appJs.includes('openCaseEditor'), 'testdata manager should render a lightweight grouped overview and lazy-load single case editors');

const prelimRoutes = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'prelim.js'), 'utf8');
for (const route of ["router.get('/items'", "router.get('/items/:id'", "router.post('/questions/:id/check'", "router.post('/import-md'", "router.get('/facets'", "router.get('/mock/papers'", "router.post('/mock/start'", "router.post('/mock/exams/:id/submit'", 'scoreTotalForMock', 'clampScoreToTotal']) {
  assert(prelimRoutes.includes(route), `missing prelim backend route ${route}`);
}
assert(!prelimRoutes.includes('req.query.questionType') && !prelimRoutes.includes('questionTypes:'), 'prelim backend should not keep retired question-type filter/facet logic');


const serverJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'server.js'), 'utf8');
assert(serverJs.includes("app.disable('x-powered-by')") && serverJs.includes('setSecurityHeaders') && serverJs.includes('staticOptions') && serverJs.includes("/api/profile"), 'server should install security headers, disable x-powered-by, and mount profile routes');
assert(serverJs.includes("res.setHeader('Cache-Control', 'no-cache')"), 'SPA fallback should set a Cache-Control header');
const authJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'auth.js'), 'utf8');
const authRoutesJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'auth.js'), 'utf8');
assert(securityJs.includes('function createRateLimit') && securityJs.includes('Retry-After'), 'security helper should expose lightweight API rate limiting');
assert(authRoutesJs.includes('hashPassword(password)') && authRoutesJs.includes('verifyPassword(password, row.password_hash)') && !authRoutesJs.includes('bcrypt.compareSync'), 'auth routes should use centralized bcrypt password helpers');
assert(authRoutesJs.includes('LOGIN_RATE_LIMIT') && authRoutesJs.includes('REGISTER_RATE_LIMIT'), 'auth routes should rate-limit login and registration');
assert(authRoutesJs.includes("process.env.NODE_ENV !== 'production'"), 'production registration should not let the first public registrant become admin');
assert(authJs.includes('SELECT id, username, role FROM users WHERE id = ?'), 'auth should validate token user still exists before using foreign-keyed user_id');
assert(authJs.includes('JWT_SECRET must be set to a strong random value in production'), 'production should reject missing or weak JWT_SECRET');
assert(authJs.includes('clearAuthCookie(req, res)'), 'stale login cookie should be cleared with request-aware cookie attributes');
assert(authJs.includes("res.cookie(COOKIE_NAME, 'deleted'") && authJs.includes('httpOnly: true') && authJs.includes('if (cookieSecure(req)) options.secure = true'), 'auth cookie clearing should use valid request-aware HttpOnly/Secure attributes');
const judgeRouteJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'judge.js'), 'utf8');
assert(judgeRouteJs.includes('JUDGE_TOKEN must be set to a strong random value in production'), 'production should reject missing or weak JUDGE_TOKEN');
const composeYaml = fs.readFileSync(path.join(__dirname, '..', 'docker-compose.yml'), 'utf8');
assert(composeYaml.includes('profiles:') && composeYaml.includes('container-judge'), 'container judge should be behind an explicit compose profile');
assert(composeYaml.includes('JWT_SECRET:?') && composeYaml.includes('JUDGE_TOKEN:?') && composeYaml.includes('ADMIN_PASSWORD:?'), 'compose should require production secrets');
assert(composeYaml.includes('network: ${DOCKER_BUILD_NETWORK:-host}'), 'docker build should use host network by default for domestic cloud/router environments');
assert(composeYaml.includes('go-judge:') && composeYaml.includes('Dockerfile.go-judge') && composeYaml.includes('127.0.0.1:${GO_JUDGE_PORT:-5050}:5050'), 'compose should include a loopback-bound go-judge service');
const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
assert(dockerfile.includes('fetch-retries 5') && dockerfile.includes('registry.npmjs.org') && dockerfile.includes('npm ci --omit=dev'), 'Dockerfile npm install should use retries and fallback registries');
const goJudgeDockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile.go-judge'), 'utf8');
assert(goJudgeDockerfile.includes('criyle/go-judge') && goJudgeDockerfile.includes('gcc g++') && goJudgeDockerfile.includes('-http-addr'), 'go-judge Dockerfile should derive from official go-judge and install language toolchains');
const oneClickScript = fs.readFileSync(path.join(__dirname, '..', 'start.sh'), 'utf8');
const deployEnvScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deploy', 'env.sh'), 'utf8');
const deployServiceScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deploy', 'services.sh'), 'utf8');
const deployDockerScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deploy', 'docker.sh'), 'utf8');
assert(oneClickScript.includes('scripts/deploy/services.sh'), 'start.sh should source modular deployment scripts');
assert(deployServiceScript.includes('JUDGE_EXECUTOR') && deployServiceScript.includes('GO_JUDGE_URL') && deployServiceScript.includes('compose up -d --build app go-judge'), 'one-click script should start web plus go-judge and point the host judge worker at go-judge');
assert(deployServiceScript.includes('ensure_web_port_available') && deployServiceScript.includes('LITEOJ_AUTO_PORT'), 'start script should auto-select a free web port when the default port is occupied');
assert(deployServiceScript.includes('ensure_go_judge_port_available') && deployServiceScript.includes('LITEOJ_GO_JUDGE_PORT_SCAN_END'), 'start script should auto-select a free go-judge port when 5050 is occupied');
assert(deployServiceScript.includes('/dev/tcp/127.0.0.1/$port'), 'port detection should also probe loopback so WSL/Docker Desktop notices Windows-side listeners');
assert(deployEnvScript.includes('ADMIN_PASSWORD=$(random_secret)'), 'one-click script should generate a random initial admin password');
assert(deployServiceScript.includes('start_judge()') && deployServiceScript.includes('judge/worker.js'), 'one-click script should start a host judge worker');
assert(deployDockerScript.includes('mirrors.tuna.tsinghua.edu.cn/docker-ce') && deployDockerScript.includes('docker.1ms.run') && deployDockerScript.includes('prepare_go_judge_base_image'), 'deployment should prefer domestic Docker apt/registry mirrors and pre-pull go-judge');

const seedProblemJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'problems', 'P1001', 'problem.json'), 'utf8'));
assert(!seedProblemJson.description.includes('数学公式示例') && !seedProblemJson.description.includes('a^2+b^2'), 'seed A+B problem should not include unrelated math formula examples');
assert(seedProblemJson.description.includes('$a$') && seedProblemJson.description.includes('$b$') && seedProblemJson.description.includes('$a+b$'), 'seed A+B problem should keep formulas related to the statement itself');
assert.deepStrictEqual(seedProblemJson.tags, ['模拟'], 'seed A+B problem should only keep the 模拟 tag');
const initJs = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'init.js'), 'utf8');
assert(initJs.includes('shouldRefreshSample') && initJs.includes('数学公式示例') && initJs.includes("raw.id === 'P1001'") && initJs.includes("JSON.stringify(['模拟'])"), 'init should refresh stored P1001 statement/tags when rerun');
assert(initJs.includes('ADMIN_PASSWORD must be set to a strong initial password in production'), 'production initialization should reject default admin password');

const routes = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'problems.js'), 'utf8');
assert(routes.includes('TESTDATA_UNZIPPED_LIMIT') && routes.includes('测试数据解压后总大小不能超过'), 'zip upload should limit total uncompressed testdata size');
assert(routes.includes("['publish', 'public', 'show']") && routes.includes("['hide', 'hidden']"), 'problem batch visibility actions should accept configured action aliases');
assert(routes.includes('copyAttachmentsAndRewriteDescription'), 'clone should copy and rewrite attachment URLs');
for (const route of ["router.patch('/:id/status'", "router.post('/:id/status'", "router.post('/:id/clone'", "router.post('/:id/attachments'", "router.get('/:id/attachments/:filename'", "router.delete('/:id'", "router.get('/:id/cases'", "router.get('/:id/cases/:caseId'", "router.post('/:id/cases'", "router.post('/:id/cases/zip'", "router.delete('/:id/cases/:caseId'", "router.post('/:id/rejudge'", "router.post('/:id/submit'"]) {
  assert(routes.includes(route), `missing backend route ${route}`);
}
assert(appJs.includes('raw.replace(/\\\\\\\((.+?)\\\\\\\)/g') || appJs.includes('raw.replace(/\\\\\((.+?)\\\\\)/g'), 'inline markdown should support \\(...\\) KaTeX math');
assert(appJs.includes('text.replace(/\\\\\\\[([\\s\\S]*?)\\\\\\\]/g') || appJs.includes('text.replace(/\\\\\[([\\s\\S]*?)\\\\\]/g'), 'markdown should support \\[...\\] display math');
assert(!appJs.includes('readAsDataURL'), 'Markdown image upload must not inline base64 data URLs');
const styleCss = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'style.css'), 'utf8');
assert(styleCss.includes('.table-action-row'), 'management table buttons should use an inner flex row so td borders stay aligned');
assert(styleCss.includes('td.actions.table-actions'), 'compatibility table action td should remain a table-cell, not a flex row');
assert(styleCss.includes('.filter-panel-card') && styleCss.includes('.filter-panel-grid'), 'shared filter panel classes should be project-owned semantic names');
assert(!outsideUiNamePattern.test(styleCss) && !cssModuleNamePattern.test(styleCss), 'stylesheet should not keep external-looking class names or comments');
assert(styleCss.includes('.button-row'), 'button rows should use shared spacing class');
assert(styleCss.includes('-webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);'), 'fixed header should list -webkit-backdrop-filter before backdrop-filter');
assert(styleCss.includes('-webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);'), 'editor footer should include Safari backdrop-filter prefix');
assert(appJs.includes('function enhanceFormAccessibility') && appJs.includes('ensureControlId') && appJs.includes('aria-label'), 'dynamic forms should be normalized with id/name/label accessibility helpers');

assert(appJs.includes("routeLink('/admin/problem/new', '新增题目'"), 'admin new-problem entry should be a real link, not a fragile inline-only button');
assert(appJs.includes("routeLink(`/admin/problem/${problemUrl(p.id)}/edit`, '编辑'"), 'problem manage edit action should be a real link');
assert(appJs.includes("routeLink(`/admin/problem/${problemUrl(p.id)}/data`, '数据'"), 'problem manage data action should be a real link');
assert(appJs.includes('case-delete-btn') && appJs.includes('data-problem-id=') && appJs.includes("btn.addEventListener('click', () => deleteCase"), 'case delete buttons should use stable data attributes and explicit event binding');
assert(appJs.includes('async function deleteCase') && appJs.includes('window.deleteCase = deleteCase'), 'deleteCase should be both locally callable and globally exported');
assert(styleCss.includes('a.btn') && styleCss.includes('.table-action-row .btn'), 'link-style action buttons should share the same UI as normal buttons');

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
assert(appJs.includes('path.match(/^\\/admin\\/problem\\/(new|[A-Z]+\\d+)$/)') && appJs.includes('return await renderProblemEditor(m[1]);') || appJs.includes('return renderProblemEditor(m[1]);'), 'new-problem route should dispatch to renderProblemEditor');
assert(appJs.includes('path.match(/^\\/admin\\/problem\\/([A-Z]+\\d+)\\/edit$/)') && appJs.includes('return await renderProblemEditor(m[1]);') || appJs.includes('return renderProblemEditor(m[1]);'), 'edit route should dispatch to renderProblemEditor');
assert(appJs.includes('path.match(/^\\/admin\\/problem\\/([A-Z]+\\d+)\\/data$/)') && appJs.includes('return await renderCaseManager(m[1]);') || appJs.includes('return renderCaseManager(m[1]);'), 'testdata route should dispatch to renderCaseManager');
assert(appJs.includes('async function saveProblemEditor') && appJs.includes("const method = isNew ? 'POST' : 'PUT'") && appJs.includes("const url = isNew ? '/api/problems' : problemApi(body.id)"), 'problem editor save should distinguish create/update');

const dbJs = fs.readFileSync(path.join(__dirname, '..', 'backend', 'db.js'), 'utf8');
for (const col of [
  "ensureColumn('problems', 'description'",
  "ensureColumn('problems', 'tags_json'",
  "ensureColumn('problems', 'time_limit'",
  "ensureColumn('problems', 'scoring_mode'",
  "ensureColumn('problems', 'checker_mode'",
  "ensureColumn('problem_cases', 'subtask'",
  "ensureColumn('submissions', 'optimize'",
]) {
  assert(dbJs.includes(col), `database migration missing ${col}`);
}
assert(appJs.includes('SCORING_MODES') && appJs.includes('CHECKER_MODES') && appJs.includes('name="scoringMode"') && appJs.includes('name="checkerMode"') && appJs.includes('name="subtask"'), 'frontend should expose scoring, checker, and subtask controls');
const sandboxJs = fs.readFileSync(path.join(__dirname, '..', 'judge', 'sandbox.js'), 'utf8');
assert(sandboxJs.includes("'--network', 'none'") && sandboxJs.includes("'--read-only'") && sandboxJs.includes("'--cap-drop', 'ALL'"), 'docker sandbox should disable network and drop container privileges');

console.log('Smoke tests passed: programming problems, judge modes, and CSP preliminary question bank logic look consistent.');
