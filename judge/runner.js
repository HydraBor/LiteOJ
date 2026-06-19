const fs = require('fs');
const path = require('path');
const languages = require('./languages');
const { compareOutput } = require('./checker');
const { createGoJudgeExecution } = require('./go-judge-client');

const TESTLIB_PATH = path.join(__dirname, 'testlib.h');

function applyScoring(details) {
  const totalPossible = details.reduce((sum, item) => sum + (Number(item.rawScore) || 0), 0);
  const allAccepted = details.length > 0 && details.every((item) => item.status === 'Accepted');
  const firstFailure = details.find((item) => item.status !== 'Accepted');

  const groups = new Map();
  for (const item of details) {
    if (!item.subtask) {
      item.score = item.status === 'Accepted' ? Number(item.rawScore) || 0 : 0;
      continue;
    }
    if (!groups.has(item.subtask)) groups.set(item.subtask, []);
    groups.get(item.subtask).push(item);
  }

  for (const group of groups.values()) {
    const groupAccepted = group.every((item) => item.status === 'Accepted');
    const groupScore = group.reduce((sum, item) => sum + (Number(item.rawScore) || 0), 0);
    let scoreAssigned = false;
    for (const item of group) {
      if (groupAccepted && !scoreAssigned) {
        item.score = groupScore;
        scoreAssigned = true;
      } else {
        item.score = 0;
      }
      if (!groupAccepted && item.status === 'Accepted') item.message = 'subtask contains failed test cases';
    }
  }

  const totalScore = details.reduce((sum, item) => sum + (Number(item.score) || 0), 0);
  const status = allAccepted
    ? 'Accepted'
    : (totalScore > 0 ? 'Partially Accepted' : (firstFailure?.status || 'Wrong Answer'));
  details.forEach((item) => { delete item.rawScore; });
  return { status, score: totalScore, details, totalPossible };
}

function checkerMessage(checkerRes, fallback) {
  return (checkerRes?.stderr || checkerRes?.stdout || fallback || '').slice(0, 1000);
}

function applySpecialJudge(runRes, checkerRes) {
  if (!checkerRes) return { status: 'System Error', message: 'checker did not run' };
  if (checkerRes.timeout) return { status: 'System Error', message: 'checker timed out' };
  if (checkerRes.memoryLimitExceeded) return { status: 'System Error', message: 'checker memory limit exceeded' };
  if (checkerRes.outputLimitExceeded) return { status: 'System Error', message: 'checker output is too large' };
  if (checkerRes.systemError) return { status: 'System Error', message: checkerMessage(checkerRes, 'checker execution system error') };
  if (checkerRes.code === 0) return { status: 'Accepted', message: checkerMessage(checkerRes, '') };
  if (checkerRes.code === 3) return { status: 'System Error', message: checkerMessage(checkerRes, 'checker failed') };
  return { status: 'Wrong Answer', message: checkerMessage(checkerRes, `checker rejected output with exit code ${checkerRes.code}`) };
}

function runResultToCase(runRes, task, test, checkerRes = null) {
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
  } else if (task.problem.checkerMode === 'special_judge') {
    const verdict = applySpecialJudge(runRes, checkerRes);
    caseStatus = verdict.status;
    message = verdict.message;
  } else {
    const mode = ['ignore_space', 'case_insensitive', 'float'].includes(task.problem.checkerMode)
      ? task.problem.checkerMode
      : 'standard';
    if (!compareOutput(runRes.stdout, test.output, {
      mode,
      tolerance: task.problem.checkerTolerance,
    })) {
      caseStatus = 'Wrong Answer';
      message = 'output differs from expected answer';
    }
  }

  return {
    caseId: test.id,
    subtask: test.subtask || '',
    sort: test.sort,
    status: caseStatus,
    score: 0,
    rawScore: Number(test.score) || 0,
    timeMs: runRes.timeMs,
    memoryKb: runRes.memoryKb || 0,
    message,
  };
}

function shouldStopJudging(caseStatus) {
  if (caseStatus === 'Accepted') return false;
  return caseStatus === 'Time Limit Exceeded'
    || caseStatus === 'Memory Limit Exceeded'
    || caseStatus === 'Output Limit Exceeded'
    || caseStatus === 'System Error';
}

function stoppedByLimit(details) {
  return details.find((item) => [
    'Time Limit Exceeded',
    'Memory Limit Exceeded',
    'Output Limit Exceeded',
    'System Error',
  ].includes(item.status))?.status || '';
}

async function judgeTask(task) {
  const language = languages[task.submission.language];
  if (!language) {
    return { status: 'System Error', score: 0, message: `Unsupported language: ${task.submission.language}`, details: [] };
  }

  let execution = null;
  try {
    execution = createGoJudgeExecution(language, task);
    if (task.problem.checkerMode === 'special_judge') {
      const checkerSource = String(task.problem.checkerSource || '');
      if (!checkerSource.trim()) {
        return { status: 'System Error', score: 0, message: 'Special Judge is enabled but checker.cpp is missing', details: [] };
      }
      const checkerCompileRes = await execution.compileChecker(checkerSource, fs.readFileSync(TESTLIB_PATH, 'utf8'), { timeoutMs: 10000, memoryLimitMb: 512 });
      if (checkerCompileRes.systemError || checkerCompileRes.code !== 0 || checkerCompileRes.timeout) {
        return {
          status: 'System Error',
          score: 0,
          timeMs: checkerCompileRes.timeMs,
          memoryKb: checkerCompileRes.memoryKb || 0,
          message: (checkerCompileRes.stderr || checkerCompileRes.stdout || 'Special Judge checker.cpp compile failed').slice(0, 4000),
          details: [],
        };
      }
    }
    if (language.compile) {
      const compileSpec = language.compile('', { optimize: task.submission.optimize !== false });
      const compileRes = await execution.compile(compileSpec, { timeoutMs: compileSpec.timeoutMs || 10000, memoryLimitMb: 512 });
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
      const timeoutMs = Number(test.timeLimit || task.problem.timeLimit || 1000);
      const runRes = await execution.run(language.run(''), {
        input: test.input,
        timeoutMs,
        memoryLimitMb: Number(test.memoryLimit || task.problem.memoryLimit || 128),
      });
      maxTime = Math.max(maxTime, runRes.timeMs);
      maxMemory = Math.max(maxMemory, runRes.memoryKb || 0);

      let checkerRes = null;
      if (task.problem.checkerMode === 'special_judge' && runRes.code === 0 && !runRes.timeout && !runRes.systemError && !runRes.memoryLimitExceeded && !runRes.outputLimitExceeded) {
        checkerRes = await execution.runChecker({
          input: test.input,
          output: runRes.stdout,
          answer: test.output,
          timeoutMs: Number(process.env.SPJ_TIMEOUT_MS || 3000),
          memoryLimitMb: Number(process.env.SPJ_MEMORY_LIMIT_MB || 256),
        });
      }
      const detail = runResultToCase(runRes, task, test, checkerRes);
      details.push(detail);
      if (shouldStopJudging(detail.status)) break;
    }

    const scored = applyScoring(details);
    return { status: stoppedByLimit(scored.details) || scored.status, score: scored.score, timeMs: maxTime, memoryKb: maxMemory, message: '', details: scored.details };
  } catch (err) {
    return { status: 'System Error', score: 0, message: String(err.stack || err.message), details: [] };
  } finally {
    if (execution && typeof execution.cleanup === 'function') {
      try { await execution.cleanup(); } catch (_) {}
    }
  }
}

module.exports = { judgeTask, applyScoring };
