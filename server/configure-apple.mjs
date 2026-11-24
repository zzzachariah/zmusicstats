#!/usr/bin/env node
/** Local, interactive Apple Music developer-token setup. Never accepts secrets in argv. */
import { createPrivateKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdtemp, open, readFile, rename, rm, unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');
const TOKEN_KEY = 'APPLE_MUSIC_DEVELOPER_TOKEN';
const APPLE_TEST_URL = 'https://api.music.apple.com/v1/test';
const TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const MAX_APPLE_LIFETIME_SECONDS = 15_777_000;
const MAX_TOKEN_LENGTH = 16_384;

class SetupError extends Error {
  constructor(message) { super(message); this.name = 'SetupError'; }
}

/** Hide even terminal echo while entering a token or private-key file path. */
function ask(label, { hidden = false } = {}) {
  return new Promise((resolve, reject) => {
    let completed = false;
    const output = new Writable({
      write(chunk, encoding, done) {
        if (!hidden) process.stdout.write(chunk, encoding);
        done();
      },
    });
    output.isTTY = true;
    output.columns = process.stdout.columns ?? 80;
    process.stdout.write(label);
    const reader = createInterface({ input: process.stdin, output, terminal: true });
    const finish = (error, value) => {
      if (completed) return;
      completed = true;
      reader.close();
      output.end();
      if (hidden) process.stdout.write('\n');
      if (error) reject(error); else resolve(value.trim());
    };
    reader.once('SIGINT', () => finish(new SetupError('已取消，配置未更改。')));
    reader.once('close', () => {
      if (!completed) finish(new SetupError('输入已关闭，配置未更改。'));
    });
    reader.question('', value => finish(null, value));
  });
}

function requireIdentifier(value, label) {
  if (!/^[A-Z0-9]{10}$/.test(value)) throw new SetupError(`${label} 应为 Apple 提供的 10 位大写字母／数字。`);
  return value;
}

function parseToken(token, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new SetupError('Token 格式不正确；需要完整的三段式 developer JWT。');
  }
  try {
    const [headerPart, payloadPart, signaturePart] = token.split('.');
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    if (header.alg !== 'ES256' || !/^[A-Z0-9]{10}$/.test(header.kid ?? '') || !/^[A-Z0-9]{10}$/.test(claims.iss ?? '')) {
      throw new SetupError('Token 必须使用 ES256，并包含有效的 Key ID 和 Team ID。');
    }
    if (Buffer.from(signaturePart, 'base64url').length !== 64) throw new SetupError('Token 的 ES256 签名长度不正确。');
    if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.iat > nowSeconds + 60 || claims.exp <= nowSeconds + 60 || claims.exp <= claims.iat || claims.exp > nowSeconds + MAX_APPLE_LIFETIME_SECONDS) {
      throw new SetupError('Token 已过期、即将过期或有效期不符合 Apple 要求；请重新生成。');
    }
    return { header, claims };
  } catch (error) {
    if (error instanceof SetupError) throw error;
    throw new SetupError('无法读取 Token 的签名信息；请检查是否完整复制。');
  }
}

function keyPathFromInput(input) {
  let value = input.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  value = value.replace(/\\ /g, ' ');
  if (value.startsWith('~/')) value = path.join(homedir(), value.slice(2));
  if (!path.isAbsolute(value) || path.extname(value).toLowerCase() !== '.p8') throw new SetupError('请输入本机 .p8 文件的完整路径；可以使用 ~/ 开头。');
  return value;
}

async function loadSigningKey(inputPath) {
  const keyPath = keyPathFromInput(inputPath);
  let bytes;
  try {
    const info = await lstat(keyPath);
    if (!info.isFile() || info.size > 16_384 || info.size === 0) throw new SetupError('所选 .p8 必须是非空的小型普通文件，不能是目录或符号链接。');
    const file = await open(keyPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { bytes = await file.readFile(); } finally { await file.close(); }
    const key = createPrivateKey(bytes);
    if (key.asymmetricKeyType !== 'ec' || !['prime256v1', 'P-256'].includes(key.asymmetricKeyDetails?.namedCurve)) {
      throw new SetupError('此私钥不是 Apple Music 要求的 P-256 椭圆曲线密钥。');
    }
    return key;
  } catch (error) {
    if (error instanceof SetupError) throw error;
    throw new SetupError('无法读取或解析 .p8 文件。请检查本机路径和文件读取权限。');
  } finally {
    bytes?.fill(0);
  }
}

function signDeveloperToken(key, teamId, keyId, nowSeconds = Math.floor(Date.now() / 1000)) {
  requireIdentifier(teamId, 'Team ID');
  requireIdentifier(keyId, 'Key ID');
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iss: teamId, iat: nowSeconds - 30, exp: nowSeconds + TOKEN_LIFETIME_SECONDS })).toString('base64url');
  const input = `${header}.${claims}`;
  try {
    const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
    return `${input}.${signature.toString('base64url')}`;
  } catch {
    throw new SetupError('本机签名失败；请确认使用关联 MusicKit 服务的正确私钥。');
  }
}

async function verifyWithApple(token, fetchImpl = globalThis.fetch) {
  parseToken(token);
  let response;
  try {
    response = await fetchImpl(APPLE_TEST_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SetupError('无法连接 Apple 验证服务或请求超时。配置未更改，请检查网络后重试。');
  }
  // Do not echo remote response bodies: verification only needs the HTTP result.
  await response.body?.cancel();
  if (!response.ok) {
    const explanations = {
      401: 'Apple 未接受此 Token。请核对 Team ID、Key ID、密钥和有效期。',
      403: 'Apple 拒绝此请求。请检查密钥是否启用 MusicKit、关联正确的 Media ID，以及 Token 是否有限定来源。',
      429: 'Apple 暂时限制了请求频率，请稍后重试。',
    };
    throw new SetupError(explanations[response.status] ?? `Apple 验证失败（HTTP ${response.status}）。配置未更改。`);
  }
  return parseToken(token).claims;
}

async function readEnvironment(envPath) {
  try {
    const info = await lstat(envPath);
    if (!info.isFile() || info.isSymbolicLink()) throw new SetupError('.env 不是普通文件；为避免修改其它位置，已停止。');
    if (info.size > 1_048_576) throw new SetupError('.env 文件过大，已停止自动修改。');
    const file = await open(envPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { return await file.readFile('utf8'); } finally { await file.close(); }
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    if (error instanceof SetupError) throw error;
    throw new SetupError('无法读取项目 .env，配置未更改。');
  }
}

function updatedEnvironment(original, token) {
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  let found = false;
  const updated = original.replace(/^[\t ]*(?:export[\t ]+)?APPLE_MUSIC_DEVELOPER_TOKEN[\t ]*=[^\r\n]*/gm, () => {
    if (found) return ''; // Avoid duplicate definitions taking precedence later.
    found = true;
    return `${TOKEN_KEY}=${token}`;
  });
  if (found) return updated;
  return `${original}${original && !original.endsWith('\n') ? eol : ''}${TOKEN_KEY}=${token}${eol}`;
}

async function saveVerifiedToken(token, envPath = ENV_PATH, fetchImpl = globalThis.fetch) {
  // No .env mutation or private-key copying happens before Apple accepts the token.
  const claims = await verifyWithApple(token, fetchImpl);
  const original = await readEnvironment(envPath);
  const temporaryPath = path.join(path.dirname(envPath), `.env.apple-${randomUUID()}.tmp`);
  let file;
  try {
    file = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    await file.writeFile(updatedEnvironment(original, token), 'utf8');
    await file.sync();
    await file.close();
    file = undefined;
    if (await readEnvironment(envPath) !== original) throw new SetupError('.env 在配置期间被其它程序修改，已停止覆盖。请重试。');
    await rename(temporaryPath, envPath);
    await chmod(envPath, 0o600);
    return claims;
  } catch (error) {
    if (error instanceof SetupError) throw error;
    throw new SetupError('保存配置失败。请检查项目目录的写入权限。');
  } finally {
    await file?.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
  }
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new SetupError('请在本机交互式终端运行此工具。为避免凭证进入命令记录，不接收管道或命令行凭证。');
  process.stdout.write('zmusicstats · Apple Music 本机配置\n\n私钥只在本机用于签名。工具只保存验证通过的 Token，不复制 .p8。\n1. 使用本机 .p8 签发 30 天 Token\n2. 粘贴现成的 developer Token（输入隐藏）\n3. 取消\n\n');
  const mode = await ask('选择 [1]：');
  if (mode === '3') { process.stdout.write('已取消，配置未更改。\n'); return; }
  let token;
  if (!mode || mode === '1') {
    const teamId = requireIdentifier(await ask('Team ID（10 位）：'), 'Team ID');
    const keyId = requireIdentifier(await ask('Key ID（10 位）：'), 'Key ID');
    const inputPath = await ask('.p8 文件完整路径（输入隐藏）：', { hidden: true });
    const key = await loadSigningKey(inputPath);
    token = signDeveloperToken(key, teamId, keyId);
  } else if (mode === '2') {
    token = await ask('Developer Token（输入隐藏）：', { hidden: true });
  } else {
    throw new SetupError('请选择 1、2 或 3。配置未更改。');
  }
  process.stdout.write('正在通过 Apple 官方服务验证…\n');
  const claims = await saveVerifiedToken(token);
  token = undefined;
  process.stdout.write(`Apple 验证通过，已更新 ${ENV_PATH}，权限为 0600。\n`);
  process.stdout.write(`Token 到期时间（北京时间）：${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' }).format(new Date(claims.exp * 1000))}\n`);
  process.stdout.write('重启开发服务后，在网页中连接 Apple Music。Apple ID 的登录和授权由你在 Apple 页面完成。\n');
}

async function selfTest() {
  const { default: assert } = await import('node:assert/strict');
  const directory = await mkdtemp(path.join(tmpdir(), 'zmusicstats-apple-setup-'));
  const envPath = path.join(directory, '.env');
  let passed = 0;
  try {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const token = signDeveloperToken(privateKey, 'TEAM123456', 'KEY1234567');
    const { claims } = parseToken(token);
    const parts = token.split('.');
    assert.equal(claims.exp - claims.iat, TOKEN_LIFETIME_SECONDS + 30);
    assert.ok(verify('sha256', Buffer.from(parts.slice(0, 2).join('.')), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url')));
    passed++;

    assert.throws(() => parseToken('invalid'), SetupError);
    const expired = signDeveloperToken(privateKey, 'TEAM123456', 'KEY1234567', Math.floor(Date.now() / 1000) - TOKEN_LIFETIME_SECONDS - 100);
    assert.throws(() => parseToken(expired), SetupError);
    passed++;

    const original = '# keep comment\r\nOTHER_SETTING=keep-this\r\nexport APPLE_MUSIC_DEVELOPER_TOKEN=old-value\r\nTAIL=value\r\n';
    const file = await open(envPath, 'wx', 0o600);
    await file.writeFile(original);
    await file.close();
    await assert.rejects(() => saveVerifiedToken(token, envPath, async () => new Response(null, { status: 401 })), SetupError);
    assert.equal(await readFile(envPath, 'utf8'), original);
    passed++;

    let checked = false;
    await saveVerifiedToken(token, envPath, async (url, options) => {
      assert.equal(url, APPLE_TEST_URL);
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      assert.equal(options.redirect, 'error');
      checked = true;
      return new Response(null, { status: 200 });
    });
    assert.ok(checked);
    const saved = await readFile(envPath, 'utf8');
    assert.ok(saved.startsWith('# keep comment\r\nOTHER_SETTING=keep-this\r\n'));
    assert.ok(saved.endsWith('TAIL=value\r\n'));
    assert.ok(saved.includes(`${TOKEN_KEY}=${token}`));
    assert.equal((await lstat(envPath)).mode & 0o777, 0o600);
    passed++;

    const { privateKey: rsaKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const wrongPath = path.join(directory, 'wrong.p8');
    const wrongFile = await open(wrongPath, 'wx', 0o600);
    await wrongFile.writeFile(rsaKey.export({ format: 'pem', type: 'pkcs8' }));
    await wrongFile.close();
    await assert.rejects(() => loadSigningKey(wrongPath), SetupError);
    passed++;
    process.stdout.write(`通过 ${passed} 项本机自检（测试密钥临时生成；未连接 Apple，未修改项目 .env）。\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  try {
    if (args.length === 1 && args[0] === '--help') {
      process.stdout.write('运行：node server/configure-apple.mjs\n本机自检：node server/configure-apple.mjs --self-test\n需要 Team ID、MusicKit Key ID 和本机 .p8 路径，或现成 developer Token。不要把凭证放在命令行参数中。\n');
    } else if (args.length === 1 && args[0] === '--self-test') {
      await selfTest();
    } else if (args.length) {
      throw new SetupError('不接受命令行凭证或其它参数。请直接运行工具并按提示输入。');
    } else await main();
  } catch (error) {
    process.stderr.write(`${error instanceof SetupError ? error.message : '配置未完成，未输出任何凭证。请检查输入和本机环境后重试。'}\n`);
    process.exitCode = 1;
  }
}
