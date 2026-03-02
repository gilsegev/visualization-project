const { spawn } = require('child_process');

function run(name, cmd, args) {
  const p = spawn(cmd, args, { stdio: 'inherit', shell: true, env: process.env });
  p.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code);
    }
  });
  return p;
}

const children = [];
function shutdown(code = 0) {
  for (const p of children) if (p && !p.killed) p.kill();
  process.exit(code);
}

children.push(run('clip-scorer', 'npm', ['run', 'start:clip-scorer']));
children.push(run('app', 'npm', ['run', 'start:app']));

const queueEnabled = String(process.env.DURABLE_QUEUE_ENABLED || 'true').toLowerCase() === 'true';
const workerCount = queueEnabled ? Math.max(1, Number(process.env.WORKER_COUNT || 1)) : 0;
for (let i = 0; i < workerCount; i++) {
  children.push(run(`worker-${i + 1}`, 'npm', ['run', 'start:worker']));
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

