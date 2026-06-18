const { judgeTask } = require('./runner');

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3000';
const JUDGE_TOKEN = process.env.JUDGE_TOKEN || 'dev-judge-token';
const POLL_INTERVAL_MS = Number(process.env.JUDGE_POLL_INTERVAL_MS || 2000);
const JUDGE_ID = process.env.JUDGE_ID || `judge-${process.pid}`;
const GO_JUDGE_URL = process.env.GO_JUDGE_URL || 'http://127.0.0.1:5050';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function postJson(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Judge-Token': JUDGE_TOKEN },
    body: JSON.stringify(data || {}),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
}

async function once() {
  const acquired = await postJson(`${BACKEND_URL}/api/judge/acquire`, { judgeId: JUDGE_ID });
  if (!acquired.task) return false;
  const task = acquired.task;
  console.log(`[${JUDGE_ID}] judging submission #${task.id}, problem ${task.problem.id}, language=${task.submission.language}`);
  const result = await judgeTask(task);
  await postJson(`${BACKEND_URL}/api/judge/${task.id}/result`, result);
  console.log(`[${JUDGE_ID}] submission #${task.id}: ${result.status}, score=${result.score}`);
  return true;
}

async function main() {
  console.log(`[${JUDGE_ID}] LiteOJ judge worker started. Backend=${BACKEND_URL}, executor=go-judge, goJudge=${GO_JUDGE_URL}`);
  while (true) {
    try {
      const worked = await once();
      if (!worked) await sleep(POLL_INTERVAL_MS);
    } catch (err) {
      console.error(`[${JUDGE_ID}]`, err.message || err);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

main();
