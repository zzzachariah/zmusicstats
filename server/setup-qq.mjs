import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../work/qq-gateway/', import.meta.url));
await mkdir(directory, { recursive: true });
await writeFile(new URL('../work/qq-gateway/package.json', import.meta.url), JSON.stringify({
  name: 'zmusicstats-local-qq-gateway',
  private: true,
  description: 'Local development only. Upstream explicitly excludes commercial use.',
  dependencies: { '@yakult-green-tea/qq-music-api': '3.3.8' },
}, null, 2) + '\n');

const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
  'install', '--ignore-scripts', '--no-fund', '--no-audit',
], { cwd: directory, stdio: 'inherit' });
child.once('error', () => {
  console.error('QQ 音乐本地依赖安装失败，请确认 npm 可用。');
  process.exitCode = 1;
});
child.once('exit', code => { process.exitCode = code ?? 1; });
