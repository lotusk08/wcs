const B64URL = /^[A-Za-z0-9_-]+$/u;
const TRANSPORT = /^[a-z-]{1,32}$/u;
const TABLE = /^[A-Za-z0-9_]{1,64}$/u;
const MAX_ID = 1400;
const MAX_KEY = 8000;
const MAX_USER = 64;
const MAX_NAME = 64;

const DIALECTS = { sqlite: 'sqlite', mysql: 'mysql', tidb: 'mysql' };

class StoreError extends Error {
  constructor(status, errno, message) {
    super(message);
    this.status = status;
    this.errno = errno;
  }
}

const cleanName = (value) =>
  typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .replace(/\s{2,}/gu, ' ')
        .trim()
        .slice(0, MAX_NAME)
    : '';

const reasonOf = (err) => String(err?.message || err).split(/, SQL: |\n/u)[0];

const isoOf = (value) => {
  if (typeof value !== 'string' || !value) return '';

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

function entryOf(item) {
  if (!item || typeof item !== 'object') return null;

  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const publicKey = typeof item.publicKey === 'string' ? item.publicKey.trim() : '';
  const userId = ['string', 'number'].includes(typeof item.userId) ? String(item.userId).trim() : '';

  if (!B64URL.test(id) || id.length > MAX_ID) return null;
  if (!B64URL.test(publicKey) || publicKey.length > MAX_KEY) return null;
  if (!userId || userId.length > MAX_USER) return null;

  const entry = { id, publicKey, userId, name: cleanName(item.name) || 'Passkey' };
  const transports = Array.isArray(item.transports)
    ? [...new Set(item.transports.filter((t) => typeof t === 'string' && TRANSPORT.test(t)))]
    : [];

  if (transports.length) entry.transports = transports;
  entry.createdAt = typeof item.createdAt === 'string' ? item.createdAt : '';

  return entry;
}

function readPasskeys(value) {
  let text = String(value ?? '')
    .replace(/^﻿/u, '')
    .trim()
    .replace(/^PASSKEYS\s*=\s*/u, '')
    .trim();

  if (/^'[\s\S]*'$/u.test(text)) text = text.slice(1, -1).trim();
  if (!text) return [];

  let list = JSON.parse(text);

  if (typeof list === 'string') list = JSON.parse(list);
  if (list && !Array.isArray(list) && typeof list === 'object') list = [list];
  if (!Array.isArray(list)) throw new TypeError('PASSKEYS is not a list');

  return list;
}

function parsePasskeys(value) {
  let list;

  try {
    list = readPasskeys(value);
  } catch {
    return [];
  }

  const seen = new Set();

  return list.map(entryOf).filter((entry) => {
    if (!entry || seen.has(entry.id)) return false;
    seen.add(entry.id);

    return true;
  });
}

function passkeyStatus(value) {
  if (!String(value ?? '').trim()) return 'none';

  return parsePasskeys(value).length ? 'ok' : 'invalid';
}

function tableDDL(dialect, table) {
  if (!TABLE.test(table)) throw new TypeError(`Table name ${JSON.stringify(table)} is not usable`);

  if (dialect === 'mysql') {
    return [
      `CREATE TABLE IF NOT EXISTS \`${table}\` (
  \`id\` int unsigned NOT NULL AUTO_INCREMENT,
  \`credential_id\` varchar(${MAX_ID}) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  \`public_key\` text CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  \`user_id\` varchar(${MAX_USER}) NOT NULL DEFAULT '',
  \`name\` varchar(255) NOT NULL DEFAULT '',
  \`transports\` varchar(255) NOT NULL DEFAULT '',
  \`source\` varchar(16) NOT NULL DEFAULT '',
  \`created_at\` varchar(32) NOT NULL DEFAULT '',
  \`last_used_at\` varchar(32) NOT NULL DEFAULT '',
  \`removed_at\` varchar(32) NOT NULL DEFAULT '',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uniq_passkey_credential\` (\`credential_id\`)
) DEFAULT CHARSET=utf8mb4`,
    ];
  }

  if (dialect === 'sqlite') {
    return [
      `CREATE TABLE IF NOT EXISTS "${table}" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "credential_id" TEXT NOT NULL,
  "public_key" TEXT NOT NULL,
  "user_id" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL DEFAULT '',
  "transports" TEXT NOT NULL DEFAULT '',
  "source" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT '',
  "last_used_at" TEXT NOT NULL DEFAULT '',
  "removed_at" TEXT NOT NULL DEFAULT ''
)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "${table}_credential_id" ON "${table}" ("credential_id")`,
    ];
  }

  throw new TypeError(`No passkey table for ${dialect}`);
}

const rowOf = (row) => ({
  id: String(row.credential_id),
  publicKey: String(row.public_key || ''),
  userId: String(row.user_id || ''),
  name: cleanName(row.name) || 'Passkey',
  transports: String(row.transports || '')
    .split(',')
    .filter((t) => TRANSPORT.test(t)),
  source: row.source === 'env' ? 'env' : 'app',
  createdAt: String(row.created_at || ''),
  lastUsedAt: String(row.last_used_at || ''),
  removedAt: String(row.removed_at || ''),
});

const dataOf = (entry, source, time) => ({
  credential_id: entry.id,
  public_key: entry.publicKey,
  user_id: entry.userId,
  name: entry.name,
  transports: (entry.transports || []).join(','),
  source,
  created_at: isoOf(entry.createdAt) || time,
  last_used_at: '',
  removed_at: '',
});

function createPasskeyStore({
  env = process.env,
  type,
  model,
  now = Date.now,
  ttl = 30 * 1000,
  retry = 60 * 1000,
  logger = console,
} = {}) {
  const dialect = model ? DIALECTS[type] : undefined;
  let table = '';
  let reason = '';

  if (!model) reason = 'Passkeys are read from PASSKEYS only: no database is connected.';
  else if (!dialect) reason = `Passkeys are read from PASSKEYS only: Waline's ${type || 'unknown'} storage is not supported for storing them.`;
  else {
    try {
      table = model().tableName;
      tableDDL(dialect, table);
    } catch (err) {
      reason = `Passkeys are read from PASSKEYS only: ${err.message}.`;
    }
  }

  let ready = null;
  let failed = null;
  let cache = null;
  let known = null;
  let loading = null;
  let generation = 0;

  const time = () => new Date(now()).toISOString();
  const db = () =>
    new Promise((resolve, reject) =>
      setImmediate(() => {
        try {
          resolve(model());
        } catch (err) {
          reject(err);
        }
      }),
    );
  const envEntries = () => parsePasskeys(env.PASSKEYS);
  const invalidate = () => {
    cache = null;
    loading = null;
    generation += 1;
  };

  function ensure() {
    if (reason) return Promise.reject(new StoreError(503, 'passkey_storage_unsupported', reason));
    if (failed && now() - failed.at < retry) return Promise.reject(failed.error);
    if (!ready) {
      ready = (async () => {
        try {
          for (const sql of tableDDL(dialect, table)) await (await db()).execute(sql);
        } catch (err) {
          try {
            await (await db()).limit(1).select();
          } catch {
            throw err;
          }
          logger.error(`[passkey] could not run CREATE TABLE IF NOT EXISTS ${table}, using the existing table:`, err);
        }
      })().then(
        () => {
          failed = null;
        },
        (err) => {
          ready = null;
          logger.error(`[passkey] could not create ${table}:`, err);
          failed = {
            at: now(),
            error: new StoreError(503, 'passkey_storage_error', `The passkey table ${table} could not be created: ${reasonOf(err)}`),
          };
          throw failed.error;
        },
      );
    }

    return ready;
  }

  const select = async () => (await (await db()).order('id ASC').select()).map(rowOf);

  const envMissing = (list) => {
    const known = new Set(list.map((row) => row.id));

    return envEntries().some((entry) => !known.has(entry.id));
  };

  async function importEnv(rows) {
    const known = new Set(rows.map((row) => row.id));
    const missing = envEntries().filter((entry) => !known.has(entry.id));

    if (!missing.length) return false;

    const at = time();

    for (const entry of missing) {
      try {
        await (await db()).add(dataOf(entry, 'env', at));
      } catch (err) {
        const exists = await (await db()).where({ credential_id: entry.id }).find();

        if (!exists || !exists.credential_id) throw err;
      }
    }

    return true;
  }

  async function fetchRows() {
    await ensure();

    let rows = await select();

    if (await importEnv(rows)) rows = await select();

    return rows;
  }

  async function rows({ fresh = false } = {}) {
    if (!fresh && cache && now() - cache.at < ttl && !envMissing(cache.rows)) return cache.rows;
    if (!fresh && loading) return loading;

    const started = generation;
    const pending = fetchRows().then((list) => {
      if (started === generation) {
        cache = { at: now(), rows: list };
        known = list;
      }

      return list;
    });

    if (!fresh) {
      loading = pending;
      pending.then(
        () => {
          if (loading === pending) loading = null;
        },
        () => {
          if (loading === pending) loading = null;
        },
      );
    }

    return pending;
  }

  const active = (list) => list.filter((row) => !row.removedAt && row.publicKey);

  const envOnly = (error) => ({
    storage: 'env',
    error,
    passkeys: envEntries().map((entry) => ({ ...entry, transports: entry.transports || [], source: 'env', lastUsedAt: '', removedAt: '' })),
  });

  async function state({ fresh = false } = {}) {
    try {
      return { storage: 'database', error: null, passkeys: active(await rows({ fresh })) };
    } catch (err) {
      if (!(err instanceof StoreError)) logger.error('[passkey] could not read passkeys:', err);

      return envOnly(err instanceof StoreError ? err : new StoreError(503, 'passkey_storage_error', `Passkeys could not be read: ${reasonOf(err)}`));
    }
  }

  const writable = async () => {
    await ensure();
    await rows();
  };

  async function add(entry) {
    await writable();

    const at = time();
    const existing = await (await db()).where({ credential_id: entry.id }).find();

    if (existing && existing.credential_id) {
      if (!existing.removed_at && existing.public_key) {
        throw new StoreError(409, 'passkey_exists', 'This passkey is already registered.');
      }

      await (await db())
        .where({ credential_id: entry.id })
        .update({ ...dataOf(entry, 'app', at), created_at: at });
    } else {
      await (await db()).add({ ...dataOf(entry, 'app', at), created_at: at });
    }

    invalidate();

    return (await rows({ fresh: true })).find((row) => row.id === entry.id);
  }

  async function remove(id) {
    await writable();

    const found = active(await rows({ fresh: true })).find((row) => row.id === id);

    if (!found) throw new StoreError(404, 'passkey_unknown', 'This passkey is not registered.');

    await (await db()).where({ credential_id: id }).update({ public_key: '', removed_at: time() });
    invalidate();

    return found;
  }

  async function rename(id, name) {
    await writable();

    const clean = cleanName(name);

    if (!clean) throw new StoreError(400, 'passkey_bad_request', 'Give the passkey a name.');

    const found = active(await rows({ fresh: true })).find((row) => row.id === id);

    if (!found) throw new StoreError(404, 'passkey_unknown', 'This passkey is not registered.');

    await (await db()).where({ credential_id: id }).update({ name: clean });
    invalidate();

    return { ...found, name: clean };
  }

  async function find(id) {
    const { storage, passkeys } = await state({ fresh: true });

    return { storage, entry: passkeys.find((row) => row.id === id) || null };
  }

  async function touch(id) {
    if (reason) return;

    try {
      await (await db()).where({ credential_id: id }).update({ last_used_at: time() });
      invalidate();
    } catch (err) {
      logger.error('[passkey] could not record the sign-in:', err);
    }
  }

  function peekEnabled() {
    if (reason || (failed && now() - failed.at < retry)) return envEntries().length > 0;
    if (!cache || now() - cache.at >= ttl || envMissing(cache.rows)) rows().catch(() => {});
    if (!known || envMissing(known)) return envEntries().length > 0 || Boolean(known && active(known).length);

    return active(known).length > 0;
  }

  return {
    table,
    dialect: dialect || null,
    unsupported: reason,
    state,
    add,
    remove,
    rename,
    find,
    touch,
    peekEnabled,
    invalidate,
    envEntries,
  };
}

module.exports = { createPasskeyStore, tableDDL, parsePasskeys, passkeyStatus, entryOf, cleanName, StoreError, DIALECTS };
