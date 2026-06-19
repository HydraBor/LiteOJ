const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const AdmZip = require('adm-zip');

const root = path.join(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liteoj-smoke-'));
const port = 3100 + Math.floor(Math.random() * 1000);
const env = { ...process.env, DATA_DIR: dataDir, PORT: String(port), NODE_ENV: 'test' };

function failWithOutput(label, result) {
  throw new Error(`${label} failed\nSTDOUT:\n${result.stdout || ''}\nSTDERR:\n${result.stderr || ''}`);
}

const init = spawnSync(process.execPath, ['scripts/init.js'], { cwd: root, env, encoding: 'utf8' });
if (init.status !== 0) failWithOutput('init', init);

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
  await waitForServer();
  for (const route of ['/admin/problem/new', '/admin/problem/P1001/edit', '/admin/problem/P1001/data', '/prelim', '/prelim/mock']) {
    const res = await fetch(`http://127.0.0.1:${port}${route}`);
    assert.strictEqual(res.status, 200, `SPA route ${route} should return index.html`);
    assert((await res.text()).includes('<main id="app"'), `SPA route ${route} should return frontend app shell`);
  }

  await request('POST', '/api/auth/login', { username: 'Algor', password: 'Wuchuanmin_2003' });
  const me = await request('GET', '/api/auth/me');
  assert.strictEqual(me.user.role, 'admin', 'admin login should work');

  const problemId = `T${Date.now()}`;
  const cloneId = `C${Date.now()}`;
  const created = await request('POST', '/api/problems', {
    id: problemId,
    title: '烟测新增题',
    description: '# 题面\n\n输入两个整数，输出它们的和。',
	    difficulty: 'beginner',
	    timeLimit: 1000,
	    memoryLimit: 128,
	    checkerMode: 'standard',
	    tags: ['烟测', '加法'],
	  });
	  assert.strictEqual(created.problem.id, problemId, 'problem create should preserve string id');
	  assert.strictEqual(created.problem.checkerMode, 'standard', 'problem create should save checker mode');
	  assert.strictEqual(created.problem.isPublic, false, 'problem create should default to hidden');

  const updated = await request('PUT', `/api/problems/${encodeURIComponent(problemId)}`, {
    id: problemId,
    title: '烟测编辑题',
    description: '# 修改后的题面\n\n用于测试编辑保存。',
    difficulty: 'popular_minus',
	    timeLimit: 1200,
	    memoryLimit: 256,
	    checkerMode: 'special_judge',
	    tags: ['烟测', '编辑'],
	    isPublic: true,
	  });
	  assert.strictEqual(updated.problem.title, '烟测编辑题', 'problem edit should update title');
	  assert.strictEqual(updated.problem.checkerMode, 'special_judge', 'problem edit should update checker mode');

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

  await request('POST', `/api/problems/${encodeURIComponent(problemId)}/status`, { isPublic: false });
  let publicList = await request('GET', '/api/problems');
  assert(!publicList.problems.some((p) => p.id === problemId), 'hidden problem should disappear from public list');
  await request('POST', `/api/problems/${encodeURIComponent(problemId)}/status`, { isPublic: true });
  publicList = await request('GET', '/api/problems');
  assert(publicList.problems.some((p) => p.id === problemId), 'public problem should appear in public list');

	  const cloned = await request('POST', `/api/problems/${encodeURIComponent(problemId)}/clone`, { id: cloneId });
	  assert.strictEqual(cloned.problem.id, cloneId, 'clone should create requested string id');
	  assert.strictEqual(cloned.problem.hasChecker, true, 'clone should copy checker.cpp');

  const submission = await request('POST', `/api/problems/${encodeURIComponent(problemId)}/submit`, {
    language: 'cpp17',
    o2: true,
    code: '#include <bits/stdc++.h>\nusing namespace std; int main(){ long long a,b; if(cin>>a>>b) cout<<a+b<<"\\n"; }\n',
  });
  assert(submission.submissionId, 'submit should create a submission record');
  const submissions = await request('GET', '/api/submissions');
  assert(submissions.submissions.some((s) => s.id === submission.submissionId), 'submission should appear in submission list');

  const prelimFacets = await request('GET', '/api/prelim/facets');
  for (const year of [2019, 2020, 2021, 2022, 2023, 2024, 2025]) {
    assert(prelimFacets.years.includes(year), `prelim facets should include seeded ${year} paper`);
  }
  const prelimItems = await request('GET', '/api/prelim/items');
  assert(prelimItems.items.length > 0, 'prelim item list should work');
  const mockPapers = await request('GET', '/api/prelim/mock/papers');
  assert(mockPapers.papers.length > 0, 'mock paper list should work');
  const started = await request('POST', '/api/prelim/mock/start', { paperId: mockPapers.papers[0].id });
  assert(started.examId, 'mock start should create an exam');
  const exam = await request('GET', `/api/prelim/mock/exams/${started.examId}`);
  assert(exam.groups.length > 0, 'mock exam should load grouped questions');
  const submitted = await request('POST', `/api/prelim/mock/exams/${started.examId}/submit`, { answers: {} });
  assert.strictEqual(submitted.examId, started.examId, 'mock submit should return report data');
  const report = await request('GET', `/api/prelim/mock/exams/${started.examId}/report`);
  assert.strictEqual(report.exam.status, 'submitted', 'mock report should be readable after submit');

  await request('DELETE', `/api/problems/${encodeURIComponent(cloneId)}`);
  await request('DELETE', `/api/problems/${encodeURIComponent(problemId)}`);
  console.log('Real smoke test passed: admin create/edit/cases/zip/clone/status/delete, submit, prelim list, and mock flow work.');
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  console.error(serverLog);
  process.exitCode = 1;
}).finally(() => {
  server.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
});
