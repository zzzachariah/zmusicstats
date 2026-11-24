import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, 'work/qq-gateway');
const packagePath = resolve(directory, 'node_modules/@yakult-green-tea/qq-music-api/package.json');
if (!existsSync(packagePath)) {
  console.error('QQ 音乐本地服务尚未安装，请运行 node server/setup-qq.mjs');
  process.exit(1);
}
const port = Number(process.env.QQ_LOCAL_PORT || '3201');
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('QQ 音乐本地服务端口无效。');
  process.exit(1);
}

const stateDirectory = resolve(directory, '.auth-state');
mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
chmodSync(stateDirectory, 0o700);
const secretPath = resolve(stateDirectory, 'session-secret');
if (!existsSync(secretPath)) {
  try { writeFileSync(secretPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
chmodSync(secretPath, 0o600);
const secret = readFileSync(secretPath, 'utf8').trim();
if (!/^[a-f0-9]{64}$/.test(secret)) {
  console.error('QQ 音乐本地会话配置无效，请检查本地服务设置。');
  process.exit(1);
}

// The upstream root starts an all-interface listener by default. Its documented test-mode
// export leaves that listener off; our worker binds the exported Koa app to loopback only.
const child = spawn(process.execPath, [resolve(root, 'server/qq-worker.mjs')], {
  cwd: directory,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    QQ_SESSION_SECRET: secret,
    QQ_AUTH_STATE_PATH: resolve(stateDirectory, 'qq-device.json'),
    QQ_AUTH_SESSION_PATH: resolve(stateDirectory, 'sessions.enc'),
    QQ_ENABLE_UPDATE_CHECK: 'false',
    QQ_DISABLE_UPDATE_CHECK: 'true',
    AUTO_OPEN_EXPLORER: 'false',
    LOG_LEVEL: 'error',
  },
  // Do not expose third-party login logs, cookies or session material to the terminal.
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
});
console.log(`QQ 音乐本地服务启动中：http://127.0.0.1:${port}`);
child.on('message', message => {
  if (message?.type === 'ready') console.log(`QQ 音乐本地服务已就绪：http://127.0.0.1:${port}`);
  if (message?.type === 'startup-error') console.error('QQ 音乐本地服务启动失败，请检查依赖或端口占用。');
});
child.once('error', () => { console.error('QQ 音乐本地服务启动失败。'); process.exitCode = 1; });
child.once('exit', code => { if (code) console.error('QQ 音乐本地服务已停止。'); process.exitCode = code ?? 0; });
process.once('SIGINT', () => child.kill('SIGTERM'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
process.once('exit', () => child.kill('SIGTERM'));
