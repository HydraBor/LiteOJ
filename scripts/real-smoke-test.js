const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const AdmZip = require('adm-zip');

const root = path.join(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteoj-smoke-'));
const port = 3100 + Math.floor(Math.random() * 1000);
const env = {
  ...process.env,
  DATA_DIR: dataDir,
  PORT: String(port),
  NODE_ENV: 'test',
  XFYUN_API_KEY: 'smoke-xfyun-key',
  DEEPSEEK_API_KEY: 'smoke-deepseek-key',
};
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';
process.env.PORT = String(port);

function failWithOutput(label, result) {
  throw new Error(`${label} failed\nSTDOUT:\n${result.stdout || ''}\nSTDERR:\n${result.stderr || ''}`);
}

const init = spawnSync(process.execPath, ['scripts/init.js'], { cwd: root, env, encoding: 'utf8' });
if (init.status !== 0) failWithOutput('init', init);
const { db: smokeDb } = require('../backend/db');

const server = spawn(process.execPath, ['backend/server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d.toString(); });
server.stderr.on('data', (d) => { serverLog += d.toString(); });

async function waitForServer() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
      if (res.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not start. Log:\n${serverLog}`);
}

let cookie = '';
const aiMockRequests = [];
const aiMockServer = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/chat/completions') {
    res.writeHead(404).end();
    return;
  }
  let raw = '';
  req.on('data', (chunk) => { raw += chunk.toString(); });
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw); } catch (_) {}
    aiMockRequests.push(body);
    const isDeepSeek = String(body.model || '').startsWith('deepseek-');
    const isReview = String(body.messages?.[0]?.content || '').includes('最终回复审查器');
    const allText = (body.messages || []).map((message) => message.content || '').join('\n');
    if (isDeepSeek && allText.includes('[force-fallback]')) {
      res.writeHead(402, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'smoke insufficient balance' } }));
      return;
    }
    const content = isReview
      ? '这是经过教学审查的最终回复。先说说你目前的思路，我们再一起完成下一步。'
      : '这是不会直接展示给学生的第一轮草稿。';
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': keep-alive\n\n');
    if (isDeepSeek) {
      res.write(`data: ${JSON.stringify({ model: body.model, choices: [{ index: 0, delta: { reasoning_content: 'hidden reasoning' }, finish_reason: null }] })}\n\n`);
    }
    const middle = Math.ceil(content.length / 2);
    for (const part of [content.slice(0, middle), content.slice(middle)]) {
      res.write(`data: ${JSON.stringify({ model: body.model, choices: [{ index: 0, delta: { content: part }, finish_reason: null }] })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ model: body.model, choices: [], usage: { prompt_tokens: 20, completion_tokens: 10, prompt_cache_hit_tokens: isDeepSeek ? 5 : 0, prompt_cache_miss_tokens: 15, completion_tokens_details: { reasoning_tokens: isDeepSeek ? 4 : 0 } } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
async function request(method, url, body, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  let finalBody = body;
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined && body !== null && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    finalBody = JSON.stringify(body);
  }
  const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers, body: finalBody });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { text }; }
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${data.error || data.detail || text}`);
  return data;
}

async function main() {
  await new Promise((resolve, reject) => {
    aiMockServer.once('error', reject);
    aiMockServer.listen(0, '127.0.0.1', resolve);
  });
  const aiMockBaseUrl = `http://127.0.0.1:${aiMockServer.address().port}`;
  await waitForServer();
  for (const route of ['/admin/problem/new', '/admin/problem/P1001/edit', '/admin/problem/P1001/data', '/prelim', '/prelim/mock', '/ai', '/admin/ai']) {
    const res = await fetch(`http://127.0.0.1:${port}${route}`);
    assert.strictEqual(res.status, 200, `SPA route ${route} should return index.html`);
    assert((await res.text()).includes('<main id="app"'), `SPA route ${route} should return frontend app shell`);
  }

  await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const me = await request('GET', '/api/auth/me');
  assert.strictEqual(me.user.role, 'admin', 'admin login should work');
  const tagList = await request('GET', '/api/tags?scope=programming');
  assert(tagList.tags.some((tag) => tag.slug === 'simulation' && tag.nameZh === '模拟'), 'tag API should expose canonical programming tags');
  assert(tagList.tags.some((tag) => tag.slug === 'dynamic-programming'), 'tag API should expose dynamic programming');

  const aiSettings = await request('GET', '/api/admin/ai-settings');
  assert.strictEqual(aiSettings.settings.provider, 'xfyun', 'AI settings should default to Xunfei Xingchen first');
  assert.strictEqual(aiSettings.settings.defaultModel, 'xopqwen36v35b', 'AI settings should default to Qwen3.6-35B-A3B');
  assert.strictEqual(aiSettings.settings.maxHistoryMbPerUser, 5, 'AI history quota should default to 5 MB per user');
  const savedAiSettings = await request('PUT', '/api/admin/ai-settings', {
    enabled: true,
    provider: 'deepseek',
    xfyunBaseUrl: aiMockBaseUrl,
    xfyunModel: 'xopqwen36v35b',
    deepseekBaseUrl: aiMockBaseUrl,
    deepseekModel: 'deepseek-v4-flash',
    deepseekThinkingEnabled: true,
    fallbackToXfyun: true,
    maxRequestsPerUserPerDay: 5,
    maxInputChars: 12000,
    maxOutputTokens: 512,
    maxHistoryMbPerUser: 5,
    contextMode: 'recent',
    contextRecentMessages: 6,
    reviewEnabled: true,
    reviewProvider: 'xfyun',
    reviewModel: 'xopqwen36v35b',
    systemPrompt: aiSettings.settings.systemPrompt,
    reviewPrompt: aiSettings.settings.reviewPrompt,
  });
  assert.strictEqual(savedAiSettings.settings.contextMode, 'recent', 'admin should save AI context mode');
  assert.strictEqual(savedAiSettings.settings.maxHistoryMbPerUser, 5, 'admin should save AI history quota');
  assert.strictEqual(savedAiSettings.settings.reviewEnabled, true, 'admin should save AI second-pass review switch');
  assert.strictEqual(savedAiSettings.settings.reviewProvider, 'xfyun', 'admin should save an independent review provider');
  assert(savedAiSettings.settings.reviewPrompt.includes('最终回复审查器'), 'admin should save AI second-pass review prompt');
  assert.strictEqual(savedAiSettings.settings.apiKeyEnv, 'DEEPSEEK_API_KEY', 'DeepSeek provider should read the DEEPSEEK_API_KEY environment variable');
  const aiConfig = await request('GET', '/api/ai/config');
  assert.strictEqual(aiConfig.defaultModel, 'deepseek-v4-flash', 'AI user config should expose the selected DeepSeek model but not the key');
  assert.strictEqual(aiConfig.deepseekThinkingEnabled, true, 'AI user config should reflect the global DeepSeek thinking mode');
  assert.strictEqual(aiConfig.historyLimitBytes, 5 * 1024 * 1024, 'AI user config should expose history quota bytes');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(aiConfig, 'apiKey'), false, 'AI config must not expose the API key');
  const aiSession = await request('POST', '/api/ai/sessions', { title: '烟测 AI 会话' });
  const aiSession2 = await request('POST', '/api/ai/sessions', { title: '烟测 AI 会话 2' });
  assert(aiSession.session.id, 'AI session create should return an id');
  const renamedAi = await request('PATCH', `/api/ai/sessions/${aiSession.session.id}`, { title: '烟测 AI 会话改名' });
  assert.strictEqual(renamedAi.session.title, '烟测 AI 会话改名', 'AI session rename should update the title');
  const aiDetail = await request('GET', `/api/ai/sessions/${aiSession.session.id}`);
  assert.strictEqual(aiDetail.messages.length, 0, 'new AI session should have no messages');
  const aiMessageRes = await fetch(`http://127.0.0.1:${port}/api/ai/sessions/${aiSession.session.id}/messages`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '你好' }),
  });
  assert.strictEqual(aiMessageRes.status, 200, 'DeepSeek generation plus Xunfei review should stream successfully');
  const firstAiStream = await aiMessageRes.text();
  assert(firstAiStream.includes('经过教学审查的最终回复'), 'only the reviewed answer should be streamed to the user');
  assert(!firstAiStream.includes('第一轮草稿'), 'the unreviewed draft must never reach the browser');
  const deepSeekCall = aiMockRequests.find((body) => String(body.model || '').startsWith('deepseek-'));
  assert.strictEqual(deepSeekCall.thinking.type, 'enabled', 'DeepSeek request should explicitly enable configured thinking mode');
  assert.strictEqual(deepSeekCall.reasoning_effort, 'high', 'DeepSeek thinking should use high reasoning effort');
  assert.strictEqual(deepSeekCall.stream_options.include_usage, true, 'DeepSeek stream should request usage totals');
  assert(/^liteoj_[a-f0-9]{32}$/.test(deepSeekCall.user_id), 'DeepSeek request should use a pseudonymous per-user id');
  const reviewedDetail = await request('GET', `/api/ai/sessions/${aiSession.session.id}`);
  assert.strictEqual(reviewedDetail.messages[1].provider, 'xfyun', 'saved final reply should record the review provider');
  assert.strictEqual(reviewedDetail.messages[1].status, 'complete', 'saved reviewed reply should be complete');
  assert(!reviewedDetail.messages[1].content.includes('第一轮草稿'), 'database should not save the hidden draft');

  const fallbackRes = await fetch(`http://127.0.0.1:${port}/api/ai/sessions/${aiSession.session.id}/messages`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '请继续讲解 [force-fallback]' }),
  });
  assert.strictEqual(fallbackRes.status, 200, 'DeepSeek 402 should fall back to Xunfei');
  const fallbackStream = await fallbackRes.text();
  assert(fallbackStream.includes('event: stage') && fallbackStream.includes('正在切换备用模型'), 'fallback should emit a clear stream stage');
  const fallbackDetail = await request('GET', `/api/ai/sessions/${aiSession.session.id}`);
  assert.strictEqual(fallbackDetail.messages.at(-1).isFallback, true, 'final reply should record that backup generation was used');
  const usage = await request('GET', '/api/admin/ai-usage?days=7');
  const adminUsage = usage.users.find((row) => row.username === 'admin');
  assert(adminUsage.upstreamCalls >= 5, 'usage analytics should count generation, review, failed primary, fallback, and fallback review calls');
  assert(adminUsage.reasoningTokens >= 4, 'usage analytics should record DeepSeek reasoning tokens without storing reasoning content');
  assert(adminUsage.fallbackCalls >= 1, 'usage analytics should count successful fallback calls');
  assert(usage.recentErrors.some((row) => row.errorCode === 'insufficient_balance'), 'usage analytics should expose a sanitized DeepSeek 402 reason to admins');
  const aiUserName = `ai${Date.now()}`;
  await request('POST', '/api/auth/register', { username: aiUserName, password: 'aipass1' });
  const foreignAiRes = await fetch(`http://127.0.0.1:${port}/api/ai/sessions/${aiSession.session.id}`, { headers: { Cookie: cookie } });
  assert.strictEqual(foreignAiRes.status, 404, 'users must not access another user AI session');
  await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const deletedAi = await request('POST', '/api/ai/sessions/batch-delete', { ids: [aiSession.session.id, aiSession2.session.id] });
  assert.strictEqual(deletedAi.deleted, 2, 'AI batch delete should remove selected owned sessions');

  const problemId = `T${Date.now()}`;
  const cloneId = `C${Date.now()}`;
  const pendingAttachmentId = `U${Date.now()}`;
  const pendingImageFd = new FormData();
  pendingImageFd.set('file', new Blob([Buffer.from('fake-png')], { type: 'image/png' }), 'preview.png');
  const pendingImage = await request('POST', `/api/problems/${encodeURIComponent(pendingAttachmentId)}/attachments`, pendingImageFd);
  assert.strictEqual(pendingImage.filename, 'preview.png', 'pending problem image should keep the uploaded filename');
  const pendingImageRes = await fetch(`http://127.0.0.1:${port}${pendingImage.url}`, { headers: { Cookie: cookie } });
  assert.strictEqual(pendingImageRes.status, 200, 'admin should preview uploaded images before the new problem is saved');

  const created = await request('POST', '/api/problems', {
    id: problemId,
    title: '烟测新增题',
    description: '# 题面\n\n输入两个整数，输出它们的和。',
    difficulty: 'beginner',
    timeLimit: 1000,
    memoryLimit: 128,
    checkerMode: 'standard',
    tags: ['simulation', 'mathematics'],
  });
  assert.strictEqual(created.problem.id, problemId, 'problem create should preserve string id');
  assert.strictEqual(created.problem.checkerMode, 'standard', 'problem create should save checker mode');
  assert.strictEqual(created.problem.isPublic, false, 'problem create should default to hidden');
  assert.deepStrictEqual(created.problem.tags.map((tag) => tag.slug), ['simulation', 'mathematics'], 'problem tags should be saved as fixed slugs');

  const updated = await request('PUT', `/api/problems/${encodeURIComponent(problemId)}`, {
    id: problemId,
    title: '烟测编辑题',
    description: '# 修改后的题面\n\n用于测试编辑保存。',
    difficulty: 'popular_minus',
    timeLimit: 1200,
    memoryLimit: 256,
    checkerMode: 'special_judge',
    tags: ['dynamic-programming', 'array-basic'],
    isPublic: true,
  });
  assert.strictEqual(updated.problem.title, '烟测编辑题', 'problem edit should update title');
  assert.strictEqual(updated.problem.checkerMode, 'special_judge', 'problem edit should update checker mode');
  assert(updated.problem.tags.some((tag) => tag.slug === 'array-basic' && tag.name === '数组'), 'problem edit should keep fixed tag display names');

  const attachmentFd = new FormData();
  attachmentFd.set('file', new Blob([Buffer.from('sample-data')], { type: 'application/zip' }), 'down.zip');
  const attachment = await request('POST', `/api/problems/${encodeURIComponent(problemId)}/attachments`, attachmentFd);
  assert.strictEqual(attachment.filename, 'down.zip', 'attachment final filename should preserve the uploaded basename');
  assert.strictEqual(attachment.originalName, 'down.zip', 'attachment upload should preserve the original display name');
  assert.strictEqual(attachment.isImage, false, 'zip attachment should be treated as a download link');
  assert(attachment.url.endsWith('/attachments/down.zip'), 'attachment URL should not include a random rename prefix');
  const attachmentRes = await fetch(`http://127.0.0.1:${port}${attachment.url}`, { headers: { Cookie: cookie } });
  assert.strictEqual(attachmentRes.status, 200, 'uploaded attachment should be downloadable');
  assert((attachmentRes.headers.get('content-disposition') || '').includes('attachment'), 'non-image attachment should be served as a download');

  const checkerSource = '#include "testlib.h"\nint main(int argc, char* argv[]) { registerTestlibCmd(argc, argv); long long x = ouf.readLong(); long long y = ans.readLong(); if (x != y) quitf(_wa, "expected %lld found %lld", y, x); quitf(_ok, "ok"); }\n';
  const checkerFd = new FormData();
  checkerFd.set('checker', new Blob([checkerSource], { type: 'text/x-c++src' }), 'checker.cpp');
	  const checker = await request('POST', `/api/problems/${encodeURIComponent(problemId)}/checker`, checkerFd);
	  assert.strictEqual(checker.hasChecker, true, 'checker upload should save checker.cpp');

  const addedCase = await request('POST', `/api/problems/${encodeURIComponent(problemId)}/cases`, {
    input: '1 2\n', output: '3\n', subtask: 'sample', score: 100, sort: 1,
  });
  assert(addedCase.case.id, 'manual case create should return a case id');
  let cases = await request('GET', `/api/problems/${encodeURIComponent(problemId)}/cases?content=1`);
  assert.strictEqual(cases.cases.length, 1, 'manual case should be listed');
  assert.strictEqual(cases.cases[0].subtask, 'sample', 'manual case should preserve subtask');

  await request('DELETE', `/api/problems/${encodeURIComponent(problemId)}/cases/${addedCase.case.id}`);
  cases = await request('GET', `/api/problems/${encodeURIComponent(problemId)}/cases`);
  assert.strictEqual(cases.cases.length, 0, 'case delete should remove the case');

  const zip = new AdmZip();
  zip.addFile('subtask1/1.in', Buffer.from('2 3\n'));
  zip.addFile('subtask1/1.out', Buffer.from('5\n'));
	  const fd = new FormData();
	  fd.set('replace', '1');
	  fd.set('autoScore', '1');
	  fd.set('subtaskMode', '1');
	  fd.set('file', new Blob([zip.toBuffer()], { type: 'application/zip' }), 'cases.zip');
	  const upload = await request('POST', `/api/problems/${encodeURIComponent(problemId)}/cases/zip`, fd);
	  assert.strictEqual(upload.imported, 1, 'zip case upload should import one pair');
	  cases = await request('GET', `/api/problems/${encodeURIComponent(problemId)}/cases?content=1`);
	  assert.strictEqual(cases.cases[0].subtask, '子任务1', 'zip subtask mode should put imported cases into subtask 1');
  const caseDownloadRes = await fetch(`http://127.0.0.1:${port}/api/problems/${encodeURIComponent(problemId)}/cases/download`, { headers: { Cookie: cookie } });
  assert.strictEqual(caseDownloadRes.status, 200, 'all testdata should be downloadable as a zip');
  const caseZip = new AdmZip(Buffer.from(await caseDownloadRes.arrayBuffer()));
  assert(caseZip.getEntries().some((entry) => entry.entryName.endsWith('.in')), 'downloaded testdata zip should contain input files');
  assert(caseZip.getEntries().some((entry) => entry.entryName.endsWith('.out')), 'downloaded testdata zip should contain output files');
  const selectedDownloadRes = await fetch(`http://127.0.0.1:${port}/api/problems/${encodeURIComponent(problemId)}/cases/download?ids=${cases.cases[0].id}`, { headers: { Cookie: cookie } });
  assert.strictEqual(selectedDownloadRes.status, 200, 'selected testdata should be downloadable as a zip');

  await request('POST', `/api/problems/${encodeURIComponent(problemId)}/status`, { isPublic: false });
  let publicList = await request('GET', '/api/problems');
  assert(!publicList.problems.some((p) => p.id === problemId), 'hidden problem should disappear from public list');
  await request('POST', `/api/problems/${encodeURIComponent(problemId)}/status`, { isPublic: true });
  publicList = await request('GET', '/api/problems');
  assert(publicList.problems.some((p) => p.id === problemId), 'public problem should appear in public list');

	  const cloned = await request('POST', `/api/problems/${encodeURIComponent(problemId)}/clone`, { id: cloneId });
	  assert.strictEqual(cloned.problem.id, cloneId, 'clone should create requested string id');
	  assert.strictEqual(cloned.problem.hasChecker, true, 'clone should copy checker.cpp');
  const clonedCases = await request('GET', `/api/problems/${encodeURIComponent(cloneId)}/cases`);
  const bulkDeleted = await request('DELETE', `/api/problems/${encodeURIComponent(cloneId)}/cases`, { ids: clonedCases.cases.map((item) => item.id) });
  assert.strictEqual(bulkDeleted.deleted, clonedCases.cases.length, 'bulk case delete should remove selected cases');
  const cloneCasesAfterDelete = await request('GET', `/api/problems/${encodeURIComponent(cloneId)}/cases`);
  assert.strictEqual(cloneCasesAfterDelete.cases.length, 0, 'bulk deleted clone should have no cases left');

  const submission = await request('POST', `/api/problems/${encodeURIComponent(problemId)}/submit`, {
    language: 'cpp17',
    o2: true,
    code: '#include <bits/stdc++.h>\nusing namespace std; int main(){ long long a,b; if(cin>>a>>b) cout<<a+b<<"\\n"; }\n',
  });
  assert(submission.submissionId, 'submit should create a submission record');
  const submissions = await request('GET', '/api/submissions');
  assert(submissions.submissions.some((s) => s.id === submission.submissionId), 'submission should appear in submission list');
  smokeDb.prepare(`UPDATE submissions SET status = 'Accepted', score = 100, time_ms = 9, memory_kb = 2048,
    message = 'accepted before rejudge', details_json = '[{"status":"AC"}]', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`).run(submission.submissionId);
  const rejudgeProblem = await request('POST', `/api/problems/${encodeURIComponent(problemId)}/rejudge`, {});
  assert(rejudgeProblem.changed >= 1, 'problem rejudge should reset existing submissions');
  const rejudgedSubmission = await request('GET', `/api/submissions/${submission.submissionId}`);
  assert.strictEqual(rejudgedSubmission.submission.status, 'Waiting', 'problem rejudge should set submission back to Waiting');
  assert.strictEqual(rejudgedSubmission.submission.score, 0, 'problem rejudge should clear the old score');
  assert.deepStrictEqual(rejudgedSubmission.submission.details, [], 'problem rejudge should clear old case details');

  const prelimFacets = await request('GET', '/api/prelim/facets');
  for (const year of [2019, 2020, 2021, 2022, 2023, 2024, 2025]) {
    assert(prelimFacets.years.includes(year), `prelim facets should include seeded ${year} paper`);
  }
  assert((prelimFacets.tags || []).some((tag) => tag.value === 'language-basics' || tag.slug === 'language-basics'), 'prelim facets should expose fixed tag slugs');
  const analytics = await request('GET', '/api/analytics/prelim/knowledge?years=2025&groupName=CSP-J');
  assert((analytics.items || []).some((item) => item.slug && item.tag), 'analytics should return slug-based tag items with display names');
  const finalProblem = await request('POST', '/api/problems', {
    id: 'CSPJ25T1',
    title: '复赛分析烟测题',
    description: '# 复赛题\n\n用于测试 T1 分析。',
    difficulty: 'popular_plus',
    timeLimit: 1000,
    memoryLimit: 128,
    tags: ['dynamic-programming', 'array-basic'],
    isPublic: true,
  });
  assert.strictEqual(finalProblem.problem.id, 'CSPJ25T1', 'final-round problem id should be accepted');
  const finalOptions = await request('GET', '/api/analytics/options?groupName=CSP-J&roundName=复赛');
  assert(finalOptions.years.includes(2025), 'final analytics options should derive years from CSPJ25T1-style problem ids');
  const finalAnalytics = await request('GET', '/api/analytics/knowledge?years=2025&groupName=CSP-J&roundName=复赛');
  assert.strictEqual(finalAnalytics.summary.problemCount, 1, 'final analytics should count public final-round programming problems');
  assert((finalAnalytics.byTask || []).some((item) => item.task === 'T1' && item.problemCount === 1), 'final analytics should group problems by T1-T4');
  assert((finalAnalytics.difficultyItems || []).some((item) => item.difficulty === 'popular_plus'), 'final analytics should expose difficulty distribution');
  assert.strictEqual(finalAnalytics.rule.includes('不计算考点权重'), true, 'final analytics should not use weighted tag scoring');
  const renamedFinal = await request('PUT', '/api/problems/CSPJ25T1', {
    id: 'CSPJ25T2',
    title: '复赛分析烟测题改名',
    description: '# 复赛题\n\n用于测试 T2 分析。',
    difficulty: 'popular_plus',
    timeLimit: 1000,
    memoryLimit: 128,
    tags: ['dynamic-programming', 'array-basic'],
    isPublic: true,
  });
  assert.strictEqual(renamedFinal.problem.id, 'CSPJ25T2', 'problem edit should allow changing the problem id');
  const renamedRead = await request('GET', '/api/problems/CSPJ25T2');
  assert.strictEqual(renamedRead.problem.title, '复赛分析烟测题改名', 'renamed problem should be readable by the new id');
  const oldFinalRes = await fetch(`http://127.0.0.1:${port}/api/problems/CSPJ25T1`, { headers: { Cookie: cookie } });
  assert.strictEqual(oldFinalRes.status, 404, 'old problem id should no longer exist after rename');
  const prelimItems = await request('GET', '/api/prelim/items');
  assert(prelimItems.items.length > 0, 'prelim item list should work');
  const prelim2023 = await request('GET', '/api/prelim/items?keyword=2023');
  assert(prelim2023.items.length > 1, 'prelim keyword search should match all items from a searched year');
  assert(prelim2023.items.every((item) => Number(item.year) === 2023), 'prelim keyword year search should return 2023 items');
  const mockPapers = await request('GET', '/api/prelim/mock/papers');
  assert(mockPapers.papers.length > 0, 'mock paper list should work');
  assert(mockPapers.papers[0].title.includes('真题卷') && !mockPapers.papers[0].title.includes('模拟卷'), 'mock paper list should name source papers as true papers');
  const started = await request('POST', '/api/prelim/mock/start', { paperId: mockPapers.papers[0].id });
  assert(started.examId, 'mock start should create an exam');
  const exam = await request('GET', `/api/prelim/mock/exams/${started.examId}`);
  assert(exam.groups.length > 0, 'mock exam should load grouped questions');
  assert(exam.exam.title.includes('真题卷') && !exam.exam.title.includes('模拟卷'), 'started mock exam should keep the true-paper title');
  const submitted = await request('POST', `/api/prelim/mock/exams/${started.examId}/submit`, { answers: {} });
  assert.strictEqual(submitted.examId, started.examId, 'mock submit should return report data');
  const report = await request('GET', `/api/prelim/mock/exams/${started.examId}/report`);
  assert.strictEqual(report.exam.status, 'submitted', 'mock report should be readable after submit');

  await request('DELETE', `/api/problems/${encodeURIComponent(cloneId)}`);
  await request('DELETE', `/api/problems/${encodeURIComponent(problemId)}`);
  await request('DELETE', '/api/problems/CSPJ25T2');
  const resetUserName = `u${Date.now()}`;
  const registered = await request('POST', '/api/auth/register', { username: resetUserName, password: 'oldpass1' });
  assert.strictEqual(registered.user.role, 'user', 'new public registrant should be a normal user');
  await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const resetResult = await request('POST', `/api/admin/users/${registered.user.id}/reset-password`);
  assert.strictEqual(resetResult.password, '123456', 'admin reset should return the fixed reset password');
  await request('POST', '/api/auth/login', { username: resetUserName, password: '123456' });
  const resetMe = await request('GET', '/api/auth/me');
  assert.strictEqual(resetMe.user.username, resetUserName, 'user should be able to login with the reset password');
  console.log('Real smoke test passed: admin problem flow, submit, AI sessions, prelim/mock flow, and final-round analytics work.');
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  console.error(serverLog);
  process.exitCode = 1;
}).finally(() => {
  server.kill('SIGTERM');
  aiMockServer.close();
  smokeDb.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
