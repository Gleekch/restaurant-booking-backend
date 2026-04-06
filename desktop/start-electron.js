const { spawn } = require('child_process');
const path = require('path');

delete process.env.ELECTRON_RUN_AS_NODE;

const electronBinary = require('electron');
const mainEntry = path.join(__dirname, 'main.js');

const child = spawn(electronBinary, [mainEntry], {
  cwd: path.resolve(__dirname, '..'),
  env: process.env,
  stdio: 'inherit'
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('Impossible de lancer Electron:', error.message);
  process.exit(1);
});
