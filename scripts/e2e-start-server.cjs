// Start the Next CLI directly so teardown can stop this exact owned process
// without Windows taskkill /T (which needs unavailable process-query privileges).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const pidFile = process.env.E2E_SERVER_PID_FILE;
if (!pidFile) throw new Error('Falta E2E_SERVER_PID_FILE. Ejecuta npm run test:e2e.');
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3100'], {
  env: process.env,
  stdio: 'inherit',
});
server.on('spawn', () => {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, JSON.stringify({ pid: server.pid }), 'utf8');
});
server.on('error', error => { console.error(error); process.exitCode = 1; });
server.on('exit', code => { process.exitCode = code ?? 0; });
