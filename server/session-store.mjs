import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync,
  renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { publicAccount } from "./account.mjs";

const AAD = Buffer.from("zmusicstats/local-session-store/v1");
const PROVIDERS = ["netease", "qq", "apple"];

function privateFile(path) {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Session store requires regular private files.");
  chmodSync(path, 0o600);
}

function recordsOnly(records, now) {
  if (!Array.isArray(records)) return [];
  return records.slice(0, 500).flatMap(record => {
    if (!record || !/^[A-Za-z0-9_-]{43}$/.test(record.id ?? "") || !Number.isFinite(record.expiresAt) || record.expiresAt <= now) return [];
    const connections = {};
    for (const id of PROVIDERS) {
      const connection = record.connections?.[id];
      const credential = connection?.credential;
      if (!credential || !["gateway", "api-key", "musickit"].includes(credential.kind)
        || typeof credential.secret !== "string" || !credential.secret || credential.secret.length > 32_768) continue;
      connections[id] = {
        credential: { kind: credential.kind, secret: credential.secret },
        account: publicAccount(connection.account),
        connectedAt: Number.isFinite(connection.connectedAt) ? connection.connectedAt : now,
      };
    }
    if (Object.keys(connections).length === 0) return [];
    return [{ id: record.id, expiresAt: record.expiresAt, version: Number.isSafeInteger(record.version) ? record.version : 0, connections }];
  });
}

export function createEncryptedSessionStore(filePath, { now = Date.now } = {}) {
  const file = resolve(filePath);
  const directory = dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink()) throw new Error("Session store directory must not be a symbolic link.");
  chmodSync(directory, 0o700);
  const keyFile = join(directory, "session.key");
  privateFile(file); privateFile(keyFile);
  if (!existsSync(keyFile)) {
    if (existsSync(file)) throw new Error("Encrypted session store key is missing; existing data was preserved.");
    writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: "wx" });
  }
  const key = readFileSync(keyFile);
  if (key.length !== 32) throw new Error("Session store key is invalid.");

  function save(records) {
    const plaintext = Buffer.from(JSON.stringify(recordsOnly(records, now())));
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(AAD);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = JSON.stringify({ version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") });
    const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      writeFileSync(temporary, envelope, { mode: 0o600, flag: "wx" });
      renameSync(temporary, file);
      chmodSync(file, 0o600);
    } catch {
      try { unlinkSync(temporary); } catch { /* No temporary file remains after a successful rename. */ }
      throw new Error("Unable to save encrypted music connections.");
    }
  }

  function load() {
    if (!existsSync(file)) return [];
    try {
      if (lstatSync(file).size > 64 * 1024 * 1024) throw new Error("Invalid store size");
      const envelope = JSON.parse(readFileSync(file, "utf8"));
      if (envelope.version !== 1) throw new Error("Unsupported store version");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(AAD);
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
      const records = JSON.parse(plaintext.toString("utf8"));
      if (!Array.isArray(records)) throw new Error("Invalid store records");
      const valid = recordsOnly(records, now());
      if (valid.length !== records.length) save(valid);
      return valid;
    } catch {
      // Fail closed. Do not silently replace unreadable encrypted connections with an empty file.
      throw new Error("Unable to restore encrypted music connections; existing data was preserved.");
    }
  }
  return { load, save };
}
