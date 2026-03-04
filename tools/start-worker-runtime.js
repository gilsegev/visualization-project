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

function runWorker(slot) {
  const child = spawn('node', ['dist/worker/main.js'], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      PROCESS_ROLE: 'worker',
      WORKER_SLOT: String(slot),
      WORKER_ID: `${os.hostname()}-w${slot}`,
    },
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const status = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[worker-pool] worker-${slot} exited (${status}), restarting in 2s`);
    setTimeout(() => {
      if (shuttingDown) return;
      children[slot - 1] = runWorker(slot);
    }, 2000).unref();
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

for (let i = 1; i <= workerCount; i += 1) {
  children.push(runWorker(i));
}

console.log(`[worker-pool] started ${workerCount} worker(s)`);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
