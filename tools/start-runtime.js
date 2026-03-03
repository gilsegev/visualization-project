const { spawn } = require('child_process');
const os = require('os');

function toBool(v, fallback = false) {
  if (v == null || v === '') return fallback;
  return String(v).toLowerCase() === 'true';
}

function toInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function run(name, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...extraEnv },
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const status = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[runtime] ${name} exited (${status}), shutting down`);
    shutdown(typeof code === 'number' ? code : 1);
  });
  return child;
}

const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child && !child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 300).unref();
}

const durableQueueEnabled = toBool(process.env.DURABLE_QUEUE_ENABLED, true);
const workerCount = durableQueueEnabled ? toInt(process.env.WORKER_COUNT, 1) : 0;

children.push(run('app', 'node', ['dist/src/main']));

for (let i = 0; i < workerCount; i += 1) {
  const slot = String(i + 1);
  children.push(
    run(`worker-${slot}`, 'node', ['dist/src/worker/main'], {
      WORKER_SLOT: slot,
      WORKER_ID: `${os.hostname()}-w${slot}`,
    }),
  );
}

console.log(`[runtime] started app + ${workerCount} worker(s)`);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

