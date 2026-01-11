import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const publicDir = path.join(rootDir, 'public');
const thirdPartyDir = path.join(rootDir, 'third_party');

function rmDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

rmDir(distDir);

console.log('[build] tsc');
execSync('tsc -p tsconfig.json', { stdio: 'inherit' });

console.log('[build] copy public/');
copyDir(publicDir, distDir);

console.log('[build] copy third_party/');
copyDir(thirdPartyDir, path.join(distDir, 'third_party'));

console.log('[build] done');
