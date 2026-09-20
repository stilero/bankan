import { execFile } from 'node:child_process';

const ADAPTERS = {
  test: ['npm', ['test']],
  lint: ['npm', ['run', 'lint']],
  build: ['npm', ['run', 'build']],
  coverage: ['npm', ['run', 'coverage']],
};

function execute(command, args, options) {
  return new Promise(resolve => {
    execFile(command, args, { cwd: options.cwd, timeout: options.timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0, stdout, stderr });
    });
  });
}

export async function runWorkflowCheck(task, node, { runner = execute } = {}) {
  const adapter = node.config?.adapter;
  const configured = adapter === 'custom'
    ? [node.config.command?.[0], node.config.command?.slice(1) || []]
    : ADAPTERS[adapter];
  if (!configured?.[0]) throw new Error(`Unsupported check adapter ${adapter || '(missing)'}`);
  const timeoutMs = node.config.timeoutMs || 30 * 60 * 1000;
  const result = await runner(configured[0], configured[1], { cwd: task.workspacePath || task.repoPath, timeoutMs });
  const detail = String(result.stderr || result.stdout || '').trim();
  return {
    passed: result.exitCode === 0,
    exitCode: result.exitCode,
    summary: detail.slice(0, 2000) || (result.exitCode === 0 ? `${adapter} passed` : `${adapter} failed`),
  };
}
