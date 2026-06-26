const MAX_OUTPUT_BYTES = Number(process.env.JUDGE_MAX_OUTPUT_BYTES || 16 * 1024 * 1024);

const NS_PER_MS = 1000000;
const BYTES_PER_MB = 1024 * 1024;

const COMMAND_PATHS = {
  gcc: '/usr/bin/gcc',
  'g++': '/usr/bin/g++',
  python3: '/usr/bin/python3',
};

function normalizeBaseUrl(value) {
  return String(value || 'http://127.0.0.1:5050').replace(/\/+$/, '');
}

function resolveCommand(command) {
  return COMMAND_PATHS[command] || command;
}

function toNs(ms) {
  return Math.max(1, Math.ceil(Number(ms || 1) * NS_PER_MS));
}

function toBytes(mb) {
  return Math.max(16, Number(mb || 128)) * BYTES_PER_MB;
}

function collector(name, max = MAX_OUTPUT_BYTES) {
  return { name, max };
}

function buildLimits(options = {}) {
  const timeoutMs = Number(options.timeoutMs || 1000);
  const clockTimeoutMs = Number(options.clockTimeoutMs || timeoutMs);
  return {
    cpuLimit: toNs(timeoutMs),
    clockLimit: toNs(clockTimeoutMs),
    memoryLimit: toBytes(options.memoryLimitMb || 128),
    procLimit: Math.max(4, Number(process.env.GO_JUDGE_PROCESS_LIMIT || 64)),
  };
}

class GoJudgeClient {
  constructor(options = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl || process.env.GO_JUDGE_URL);
    this.authToken = options.authToken || process.env.GO_JUDGE_TOKEN || '';
  }

  headers() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.authToken) headers.Authorization = `Bearer ${this.authToken}`;
    return headers;
  }

  async run(request) {
    const res = await fetch(`${this.baseUrl}/run`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(request),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) {}
    if (!res.ok) {
      throw new Error(`go-judge /run failed: ${res.status} ${res.statusText}: ${text.slice(0, 1000)}`);
    }
    if (!Array.isArray(data)) {
      throw new Error(`go-judge /run returned unexpected payload: ${text.slice(0, 1000)}`);
    }
    return data;
  }

  async deleteFile(fileId) {
    if (!fileId) return;
    try {
      await fetch(`${this.baseUrl}/file/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
        headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {},
      });
    } catch (_) {
      // Cached files have a server-side TTL; cleanup is best-effort.
    }
  }
}

function resultText(result, name) {
  const value = result?.files?.[name];
  if (typeof value === 'string') return value;
  if (value && typeof value.content === 'string') return value.content;
  return '';
}

function outputLimitExceeded(result) {
  if (String(result?.status || '') === 'Output Limit Exceeded') return true;
  return (result?.fileError || []).some((item) => String(item?.type || '') === 'CollectSizeExceeded');
}

function normalizeResult(result) {
  const status = String(result?.status || 'Internal Error');
  const exitStatus = Number.isFinite(Number(result?.exitStatus)) ? Number(result.exitStatus) : null;
  const signal = result?.signal || null;
  const stderr = resultText(result, 'stderr');
  const stdout = resultText(result, 'stdout');
  const fileErrors = (result?.fileError || [])
    .map((item) => [item?.name, item?.type, item?.message].filter(Boolean).join(': '))
    .filter(Boolean)
    .join('\n');

  return {
    code: status === 'Accepted' ? (exitStatus ?? 0) : (exitStatus ?? -1),
    signal,
    stdout,
    stderr: stderr || fileErrors,
    timeMs: Math.ceil(Number(result?.time || result?.runTime || 0) / NS_PER_MS),
    memoryKb: Math.ceil(Number(result?.memory || 0) / 1024),
    timeout: status === 'Time Limit Exceeded',
    outputLimitExceeded: outputLimitExceeded(result),
    memoryLimitExceeded: status === 'Memory Limit Exceeded',
    systemError: status === 'Internal Error' || status === 'File Error',
    status,
  };
}

function createGoJudgeExecution(language, task) {
  const client = new GoJudgeClient();
  const cachedFileIds = [];
  let executableFileId = null;
  let checkerExecutableFileId = null;
  const sourceName = language.source;
  const executableName = language.executable;
  const sourceContent = task.submission.code;

  function commonCmd(spec, options = {}) {
    return {
      args: [resolveCommand(spec.command), ...(spec.args || [])],
      env: [
        'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        'HOME=/tmp',
        'TMPDIR=/tmp',
      ],
      files: [
        { content: options.input || '' },
        collector('stdout', Number(options.stdoutMax || MAX_OUTPUT_BYTES) + 1),
        collector('stderr', Number(options.stderrMax || MAX_OUTPUT_BYTES)),
      ],
      ...buildLimits(options),
    };
  }

  async function compile(compileSpec, options = {}) {
    const cmd = {
      ...commonCmd(compileSpec, {
        timeoutMs: compileSpec.timeoutMs || options.timeoutMs || 10000,
        clockTimeoutMs: (compileSpec.timeoutMs || options.timeoutMs || 10000) + 5000,
        memoryLimitMb: options.memoryLimitMb || 512,
      }),
      copyIn: {
        [sourceName]: { content: sourceContent },
      },
      copyOut: ['stdout', 'stderr'],
    };
    if (executableName) cmd.copyOutCached = [executableName];

    const [result] = await client.run({ cmd: [cmd] });
    if (result?.fileIds) {
      Object.values(result.fileIds).forEach((id) => {
        if (id) cachedFileIds.push(id);
      });
      executableFileId = result.fileIds[executableName] || null;
    }
    const normalized = normalizeResult(result);
    if (executableName && normalized.code === 0 && !executableFileId) {
      normalized.code = -1;
      normalized.systemError = true;
      normalized.stderr = normalized.stderr || 'go-judge did not return compiled executable file id';
    }
    return normalized;
  }

  async function compileChecker(source, testlibContent, options = {}) {
    const cmd = {
      ...commonCmd({
        command: 'g++',
        args: ['checker.cpp', '-O2', '-std=c++17', '-DONLINE_JUDGE', '-I.', '-o', 'checker'],
        timeoutMs: options.timeoutMs || 10000,
      }, {
        timeoutMs: options.timeoutMs || 10000,
        clockTimeoutMs: (options.timeoutMs || 10000) + 5000,
        memoryLimitMb: options.memoryLimitMb || 512,
      }),
      copyIn: {
        'checker.cpp': { content: source || '' },
        'testlib.h': { content: testlibContent || '' },
      },
      copyOut: ['stdout', 'stderr'],
      copyOutCached: ['checker'],
    };
    const [result] = await client.run({ cmd: [cmd] });
    if (result?.fileIds) {
      Object.values(result.fileIds).forEach((id) => {
        if (id) cachedFileIds.push(id);
      });
      checkerExecutableFileId = result.fileIds.checker || null;
    }
    const normalized = normalizeResult(result);
    if (normalized.code === 0 && !checkerExecutableFileId) {
      normalized.code = -1;
      normalized.systemError = true;
      normalized.stderr = normalized.stderr || 'go-judge did not return compiled checker executable file id';
    }
    return normalized;
  }

  async function run(runSpec, options = {}) {
    const copyIn = {};
    if (executableName) {
      if (!executableFileId) {
        return {
          code: -1,
          signal: null,
          stdout: '',
          stderr: 'compiled executable is not available',
          timeMs: 0,
          memoryKb: 0,
          timeout: false,
          outputLimitExceeded: false,
          systemError: true,
          status: 'Internal Error',
        };
      }
      copyIn[executableName] = { fileId: executableFileId };
    } else {
      copyIn[sourceName] = { content: sourceContent };
    }

    const cmd = {
      ...commonCmd(runSpec, {
        input: options.input || '',
        timeoutMs: options.timeoutMs || 1000,
        clockTimeoutMs: options.timeoutMs || 1000,
        memoryLimitMb: options.memoryLimitMb || 128,
      }),
      copyIn,
      copyOut: ['stdout', 'stderr'],
    };
    const [result] = await client.run({ cmd: [cmd] });
    return normalizeResult(result);
  }

  async function runChecker(options = {}) {
    if (!checkerExecutableFileId) {
      return {
        code: -1,
        signal: null,
        stdout: '',
        stderr: 'compiled checker is not available',
        timeMs: 0,
        memoryKb: 0,
        timeout: false,
        outputLimitExceeded: false,
        systemError: true,
        status: 'Internal Error',
      };
    }
    const cmd = {
      ...commonCmd({
        command: './checker',
        args: ['input.txt', 'output.txt', 'answer.txt'],
      }, {
        timeoutMs: options.timeoutMs || 3000,
        clockTimeoutMs: options.clockTimeoutMs || (Number(options.timeoutMs || 3000) + 1000),
        memoryLimitMb: options.memoryLimitMb || 256,
        stdoutMax: options.stdoutMax || 8192,
        stderrMax: options.stderrMax || 8192,
      }),
      copyIn: {
        checker: { fileId: checkerExecutableFileId },
        'input.txt': { content: options.input || '' },
        'output.txt': { content: options.output || '' },
        'answer.txt': { content: options.answer || '' },
      },
      copyOut: ['stdout', 'stderr'],
    };
    const [result] = await client.run({ cmd: [cmd] });
    return normalizeResult(result);
  }

  async function cleanup() {
    await Promise.all([...new Set(cachedFileIds)].map((id) => client.deleteFile(id)));
  }

  return { compile, compileChecker, run, runChecker, cleanup };
}

module.exports = {
  GoJudgeClient,
  createGoJudgeExecution,
  normalizeResult,
  resolveCommand,
};
