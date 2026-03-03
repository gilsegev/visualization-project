const { spawn } = require('child_process');

function run(name, cmd, args) {
  const p = spawn(cmd, args, { stdio: 'inherit', shell: true });
  p.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      process.exit(code);
    }
  });
  return p;
}

const clip = run('clip-scorer', 'npm', ['run', 'start:clip-scorer']);
const app = run('app', 'npm', ['run', 'start:dev']);

const shutdown = () => {
  for (const p of [clip, app]) {
    if (p && !p.killed) p.kill();
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

