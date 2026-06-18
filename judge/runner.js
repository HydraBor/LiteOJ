const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const languages = require('./languages');
const { compareOutput } = require('./checker');
const { sandboxSpec } = require('./sandbox');
const { createGoJudgeExecution } = require('./go-judge-client');

const MAX_OUTPUT_BYTES = Number(process.env.JUDGE_MAX_OUTPUT_BYTES || 1024 * 1024);
const JUDGE_EXECUTOR = String(process.env.JUDGE_EXECUTOR || 'local').toLowerCase();

function makeTempDir(submissionId) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `liteoj-${submissionId}-`));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

function normalizeExecutorMode(value) {
  const mode = String(value || 'local').toLowerCase();
  return mode === 'gojudge' || mode === 'go-judge' ? 'go-judge' : 'local';
}

function runProcess(spec, options = {}) {
  const timeoutMs = options.timeoutMs || spec.timeoutMs || 1000;
  const input = options.input || '';
  const cwd = options.cwd || process.cwd();
  const memoryLimitMb = Math.max(16, Number(options.memoryLimitMb || 128));

  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let killedByTimeout = false;
    let outputLimitExceeded = false;

    const command = spec.command;
    const args = spec.args || [];
    const child = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: { ...process.env, HOME: cwd },
    });

    function stopChild() {
      killedByTimeout = true;
      if (typeof spec.onTimeout === 'function') {
        try { spec.onTimeout(); } catch (_) {}
      }
      child.kill('SIGKILL');
    }

    const timer = setTimeout(stopChild, timeoutMs);

    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        outputLimitExceeded = true;
        if (typeof spec.onTimeout === 'function') {
          try { spec.onTimeout(); } catch (_) {}
        }
        child.kill('SIGKILL');
        return;
      }
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > MAX_OUTPUT_BYTES) stderr = stderr.slice(0, MAX_OUTPUT_BYTES);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, signal: null, stdout, stderr: String(err.message), timeMs: Date.now() - started, timeout: false, outputLimitExceeded });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timeMs: Date.now() - started, timeout: killedByTimeout, outputLimitExceeded });
    });

    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

function createLocalExecution() {
  return {
    compile: (compileSpec, options = {}) => runProcess(
      sandboxSpec(compileSpec, { cwd: options.cwd, memoryLimitMb: options.memoryLimitMb, phase: 'compile' }),
      options,
    ),
    run: (runSpec, options = {}) => runProcess(
      sandboxSpec(runSpec, { cwd: options.cwd, memoryLimitMb: options.memoryLimitMb, phase: 'run' }),
      options,
    ),
    cleanup: async () => {},
  };
}

function createExecution(language, task) {
  if (normalizeExecutorMode(JUDGE_EXECUTOR) === 'go-judge') return createGoJudgeExecution(language, task);
  return createLocalExecution();
}

function normalizeScoringMode(value) {
  return String(value || 'oi') === 'acm' ? 'acm' : 'oi';
}

function applyScoring(details, scoringMode = 'oi') {
  const mode = normalizeScoringMode(scoringMode);
  const totalPossible = details.reduce((sum, item) => sum + (Number(item.rawScore) || 0), 0);
  const allAccepted = details.length > 0 && details.every((item) => item.status === 'Accepted');
  const firstFailure = details.find((item) => item.status !== 'Accepted');
  let totalScore = 0;

  if (mode === 'acm') {
    totalScore = allAccepted ? totalPossible : 0;
    details.forEach((item) => { item.score = allAccepted && item.status === 'Accepted' ? Number(item.rawScore) || 0 : 0; });
  } else {
    const hasSubtasks = details.some((item) => item.subtask);
    if (hasSubtasks) {
      const groups = new Map();
      for (const item of details) {
        const key = item.subtask ? `subtask:${item.subtask}` : `case:${item.caseId}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      }
      for (const group of groups.values()) {
        const groupAccepted = group.every((item) => item.status === 'Accepted');
        for (const item of group) {
          item.score = groupAccepted && item.status === 'Accepted' ? Number(item.rawScore) || 0 : 0;
          if (!groupAccepted && item.status === 'Accepted' && item.subtask) item.message = 'subtask contains failed test cases';
        }
      }
      totalScore = details.reduce((sum, item) => sum + (Number(item.score) || 0), 0);
    } else {
      for (const item of details) item.score = item.status === 'Accepted' ? Number(item.rawScore) || 0 : 0;
      totalScore = details.reduce((sum, item) => sum + (Number(item.score) || 0), 0);
    }
  }

  const status = allAccepted
    ? 'Accepted'
    : (totalScore > 0 ? 'Partially Accepted' : (firstFailure?.status || 'Wrong Answer'));
  details.forEach((item) => { delete item.rawScore; });
  return { status, score: totalScore, details, totalPossible };
}

async function judgeTask(task) {
  const language = languages[task.submission.language];
  if (!language) {
    return { status: 'System Error', score: 0, message: `Unsupported language: ${task.submission.language}`, details: [] };
  }

  const workdir = makeTempDir(task.id);
  const sourcePath = path.join(workdir, language.source);
  fs.writeFileSync(sourcePath, task.submission.code, 'utf8');

  let execution = null;
  try {
    execution = createExecution(language, task);
    if (language.compile) {
      const compileSpec = language.compile(workdir, { optimize: task.submission.optimize !== false });
      const compileRes = await execution.compile(compileSpec, { cwd: workdir, timeoutMs: compileSpec.timeoutMs || 10000, memoryLimitMb: 512 });
      if (compileRes.systemError) {
        return {
          status: 'System Error',
          score: 0,
          timeMs: compileRes.timeMs,
          memoryKb: compileRes.memoryKb || 0,
          message: (compileRes.stderr || compileRes.stdout || 'Judge compile system error').slice(0, 4000),
          details: [],
        };
      }
      if (compileRes.code !== 0 || compileRes.timeout) {
        return {
          status: 'Compile Error',
          score: 0,
          timeMs: compileRes.timeMs,
          memoryKb: compileRes.memoryKb || 0,
          message: (compileRes.stderr || compileRes.stdout || 'Compile failed').slice(0, 4000),
          details: [],
        };
      }
    }

    const details = [];
    let maxTime = 0;
    let maxMemory = 0;
    const cases = task.cases || [];
    if (cases.length === 0) {
      return { status: 'System Error', score: 0, message: 'No test cases configured', details: [] };
    }

    for (const test of cases) {
      const runRes = await execution.run(language.run(workdir), {
        cwd: workdir,
        input: test.input,
        timeoutMs: Number(task.problem.timeLimit || 1000) + 200,
        memoryLimitMb: task.problem.memoryLimit,
      });
      maxTime = Math.max(maxTime, runRes.timeMs);
      maxMemory = Math.max(maxMemory, runRes.memoryKb || 0);

      let caseStatus = 'Accepted';
      let message = '';
      if (runRes.timeout) {
        caseStatus = 'Time Limit Exceeded';
        message = 'program timed out';
      } else if (runRes.memoryLimitExceeded) {
        caseStatus = 'Memory Limit Exceeded';
        message = 'memory limit exceeded';
      } else if (runRes.outputLimitExceeded) {
        caseStatus = 'Output Limit Exceeded';
        message = 'output is too large';
      } else if (runRes.systemError) {
        caseStatus = 'System Error';
        message = (runRes.stderr || runRes.stdout || 'judge execution system error').slice(0, 1000);
      } else if (runRes.code !== 0) {
        caseStatus = 'Runtime Error';
        message = (runRes.stderr || `exit code ${runRes.code}, signal ${runRes.signal || ''}`).slice(0, 1000);
      } else if (!compareOutput(runRes.stdout, test.output, {
        mode: task.problem.checkerMode || 'standard',
        tolerance: task.problem.checkerTolerance,
      })) {
        caseStatus = 'Wrong Answer';
        message = 'output differs from expected answer';
      }

      details.push({
        caseId: test.id,
        subtask: test.subtask || '',
        sort: test.sort,
        status: caseStatus,
        score: 0,
        rawScore: Number(test.score) || 0,
        timeMs: runRes.timeMs,
        memoryKb: runRes.memoryKb || 0,
        message,
      });
    }

    const scored = applyScoring(details, task.problem.scoringMode || 'oi');
    return { status: scored.status, score: scored.score, timeMs: maxTime, memoryKb: maxMemory, message: '', details: scored.details };
  } catch (err) {
    return { status: 'System Error', score: 0, message: String(err.stack || err.message), details: [] };
  } finally {
    if (execution && typeof execution.cleanup === 'function') {
      try { await execution.cleanup(); } catch (_) {}
    }
    cleanup(workdir);
  }
}

module.exports = { judgeTask, runProcess, applyScoring, createExecution, normalizeExecutorMode };
