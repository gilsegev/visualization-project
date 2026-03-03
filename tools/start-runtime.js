const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');

function toBool(v, fallback = false) {
  if (v == null || v === '') return fallback;
  return String(v).toLowerCase() === 'true';
}

function toInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function run(name, command, args, extraEnv = {}, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...extraEnv },
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const status = signal ? `signal ${signal}` : `code ${code}`;
    if (options.fatal) {
      console.error(`[runtime] ${name} exited (${status}), shutting down`);
      shutdown(typeof code === 'number' ? code : 1);
      return;
    }
    console.error(`[runtime] ${name} exited (${status}), restarting in 2s`);
    setTimeout(() => {
      if (shuttingDown) return;
      run(name, command, args, extraEnv, options);
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

function ensureLinuxPlaywrightDeps() {
  if (process.platform !== 'linux') return;
  if (toBool(process.env.SKIP_RUNTIME_APT, false)) return;
  if (!fs.existsSync('/usr/bin/apt-get')) return;

  const glibCheck = spawnSync('sh', ['-lc', 'ldconfig -p | grep -q "libglib-2.0.so.0"']);
  if (glibCheck.status === 0) return;

  console.log('[runtime] libglib not found; installing Playwright runtime libs...');

  const update = spawnSync('apt-get', ['update'], { stdio: 'inherit' });
  if (update.status !== 0) {
    console.error('[runtime] apt-get update failed; continuing without runtime lib install.');
    return;
  }

  const install = spawnSync(
    'apt-get',
    [
      'install',
      '-y',
      '--no-install-recommends',
      'libglib2.0-0',
      'libnss3',
      'libnspr4',
      'libatk1.0-0',
      'libatk-bridge2.0-0',
      'libatspi2.0-0',
      'libx11-6',
      'libxcomposite1',
      'libxdamage1',
      'libxfixes3',
      'libxrandr2',
      'libgbm1',
      'libxkbcommon0',
      'libasound2',
      'libxshmfence1',
      'libdrm2',
      'libgtk-3-0',
      'libpango-1.0-0',
      'libcairo2',
      'libxcb1',
      'ca-certificates',
      'fonts-liberation',
    ],
    { stdio: 'inherit' },
  );

  if (install.status !== 0) {
    console.error('[runtime] apt-get install failed; continuing with existing image libs.');
    return;
  }

  console.log('[runtime] Playwright runtime libs installed.');
}

ensureLinuxPlaywrightDeps();

children.push(run('app', 'node', ['dist/src/main'], { PROCESS_ROLE: 'app' }, { fatal: true }));

for (let i = 0; i < workerCount; i += 1) {
  const slot = String(i + 1);
  children.push(
    run(
      `worker-${slot}`,
      'node',
      ['dist/src/worker/main'],
      {
        PROCESS_ROLE: 'worker',
        WORKER_SLOT: slot,
        WORKER_ID: `${os.hostname()}-w${slot}`,
      },
      { fatal: false },
    ),
  );
}

console.log(`[runtime] started app + ${workerCount} worker(s)`);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
