const path = require('path');
const { spawnSync } = require('child_process');

const SANDBOX_MODE = String(process.env.JUDGE_SANDBOX || 'host').toLowerCase();

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function hostLimitedSpec(spec, options = {}) {
  const memoryKb = Math.max(16, Number(options.memoryLimitMb || 128)) * 1024;
  const fileLimitKb = Math.max(1024, Number(process.env.JUDGE_FILE_LIMIT_KB || 65536));
  const processLimit = Math.max(4, Number(process.env.JUDGE_PROCESS_LIMIT || 64));
  const quoted = [spec.command, ...(spec.args || [])].map(shellQuote).join(' ');
  return {
    command: 'bash',
    args: ['-lc', `ulimit -v ${memoryKb}; ulimit -f ${fileLimitKb}; ulimit -u ${processLimit}; exec ${quoted}`],
  };
}

function dockerLimitedSpec(spec, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const image = process.env.JUDGE_SANDBOX_IMAGE || 'liteoj:latest';
  const memoryMb = Math.max(16, Number(options.memoryLimitMb || 128));
  const cpus = String(process.env.JUDGE_SANDBOX_CPUS || '1');
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
  const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;
  const user = process.env.JUDGE_SANDBOX_USER || `${uid}:${gid}`;
  const phase = String(options.phase || 'run').replace(/[^a-zA-Z0-9_-]/g, '');
  const name = `liteoj-${path.basename(cwd).replace(/[^a-zA-Z0-9_-]/g, '-')}-${phase}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    command: 'docker',
    args: [
      'run', '-i', '--rm', '--name', name,
      '--network', 'none',
      '--cpus', cpus,
      '--memory', `${memoryMb}m`,
      '--memory-swap', `${memoryMb}m`,
      '--pids-limit', String(Math.max(4, Number(process.env.JUDGE_PROCESS_LIMIT || 64))),
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--read-only',
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m',
      '-e', 'HOME=/tmp',
      '-e', 'TMPDIR=/tmp',
      '-v', `${cwd}:/work:rw`,
      '-w', '/work',
      '--user', user,
      image,
      spec.command,
      ...(spec.args || []),
    ],
    onTimeout: () => {
      spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    },
  };
}

function sandboxSpec(spec, options = {}) {
  if (SANDBOX_MODE === 'docker') return dockerLimitedSpec(spec, options);
  return hostLimitedSpec(spec, options);
}

module.exports = {
  SANDBOX_MODE,
  sandboxSpec,
  hostLimitedSpec,
  dockerLimitedSpec,
};
