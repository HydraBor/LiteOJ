const languages = require('./languages');
const { compareOutput } = require('./checker');
const { createGoJudgeExecution } = require('./go-judge-client');

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

function runResultToCase(runRes, task, test) {
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
      const timeoutMs = Number(task.problem.timeLimit || 1000);
      const runRes = await execution.run(language.run(''), {
        input: test.input,
        timeoutMs,
        memoryLimitMb: task.problem.memoryLimit,
      });
      maxTime = Math.max(maxTime, runRes.timeMs);
      maxMemory = Math.max(maxMemory, runRes.memoryKb || 0);

      const detail = runResultToCase(runRes, task, test);
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
