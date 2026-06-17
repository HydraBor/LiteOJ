const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const languages = require('./languages');
const { standardCheck } = require('./checker');

const MAX_OUTPUT_BYTES = Number(process.env.JUDGE_MAX_OUTPUT_BYTES || 1024 * 1024);

function makeTempDir(submissionId) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `liteoj-${submissionId}-`));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
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

    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        outputLimitExceeded = true;
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

function wrapRunWithLimits(runSpec, memoryLimitMb) {
  // ulimit -v is a lightweight teaching sandbox. For production, replace this file with isolate/nsjail/firecracker.
  const memoryKb = Math.max(16, Number(memoryLimitMb || 128)) * 1024;
  const quoted = [runSpec.command, ...(runSpec.args || [])]
    .map((part) => `'${String(part).replace(/'/g, `'\\''`)}'`)
    .join(' ');
  return {
    command: 'bash',
    args: ['-lc', `ulimit -v ${memoryKb}; ${quoted}`],
  };
}

async function judgeTask(task) {
  const language = languages[task.submission.language];
  if (!language) {
    return { status: 'System Error', score: 0, message: `Unsupported language: ${task.submission.language}`, details: [] };
  }

  const workdir = makeTempDir(task.id);
  const sourcePath = path.join(workdir, language.source);
  fs.writeFileSync(sourcePath, task.submission.code, 'utf8');

  try {
    if (language.compile) {
      const compileSpec = language.compile(workdir, { optimize: task.submission.optimize !== false });
      const compileRes = await runProcess(compileSpec, { cwd: workdir, timeoutMs: compileSpec.timeoutMs || 10000, memoryLimitMb: 512 });
      if (compileRes.code !== 0 || compileRes.timeout) {
        return {
          status: 'Compile Error',
          score: 0,
          timeMs: compileRes.timeMs,
          memoryKb: 0,
          message: (compileRes.stderr || compileRes.stdout || 'Compile failed').slice(0, 4000),
          details: [],
        };
      }
    }

    const details = [];
    let totalScore = 0;
    let maxTime = 0;
    let status = 'Accepted';
    const cases = task.cases || [];
    if (cases.length === 0) {
      return { status: 'System Error', score: 0, message: 'No test cases configured', details: [] };
    }

    for (const test of cases) {
      const runSpec = wrapRunWithLimits(language.run(workdir), task.problem.memoryLimit);
      const runRes = await runProcess(runSpec, {
        cwd: workdir,
        input: test.input,
        timeoutMs: Number(task.problem.timeLimit || 1000) + 200,
        memoryLimitMb: task.problem.memoryLimit,
      });
      maxTime = Math.max(maxTime, runRes.timeMs);

      let caseStatus = 'Accepted';
      let message = '';
      if (runRes.timeout) {
        caseStatus = 'Time Limit Exceeded';
        message = 'program timed out';
      } else if (runRes.outputLimitExceeded) {
        caseStatus = 'Output Limit Exceeded';
        message = 'output is too large';
      } else if (runRes.code !== 0) {
        caseStatus = 'Runtime Error';
        message = (runRes.stderr || `exit code ${runRes.code}, signal ${runRes.signal || ''}`).slice(0, 1000);
      } else if (!standardCheck(runRes.stdout, test.output)) {
        caseStatus = 'Wrong Answer';
        message = 'output differs from expected answer';
      } else {
        totalScore += Number(test.score) || 0;
      }

      details.push({
        caseId: test.id,
        sort: test.sort,
        status: caseStatus,
        score: caseStatus === 'Accepted' ? Number(test.score) || 0 : 0,
        timeMs: runRes.timeMs,
        memoryKb: 0,
        message,
      });

      if (caseStatus !== 'Accepted' && status === 'Accepted') status = caseStatus;
    }

    if (totalScore >= 100 && status === 'Accepted') status = 'Accepted';
    if (totalScore > 0 && totalScore < 100 && status !== 'Accepted') status = 'Partially Accepted';
    return { status, score: totalScore, timeMs: maxTime, memoryKb: 0, message: '', details };
  } catch (err) {
    return { status: 'System Error', score: 0, message: String(err.stack || err.message), details: [] };
  } finally {
    cleanup(workdir);
  }
}

module.exports = { judgeTask, runProcess };
