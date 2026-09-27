import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { mkdir } from 'node:fs/promises';
import { config } from './config';
export interface Database { query<T = Record<string, any>>(sql: string, params?: any[]): Promise<{ rows: T[] }>; close(): Promise<void>; }
export async function openDatabase(url = config.DATABASE_URL, directory = '.data/postgres'): Promise<Database> {
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    // One durable coordinator owns all game and financial transitions.
    const lock = await pool.query('SELECT pg_try_advisory_lock(713531922) AS acquired');
    if (!lock.rows[0].acquired) { await pool.end(); throw new Error('Another GRAILSHOT coordinator is already running.'); }
    return { query: async <T>(sql: string, params?: any[]) => ({ rows: (await pool.query(sql, params)).rows as T[] }), close: () => pool.end() };
  }
  if (directory !== 'memory://') await mkdir(directory, { recursive: true });
  const database = new PGlite(directory);
  await database.waitReady;
  return { query: async (sql, params) => database.query(sql, params), close: () => database.close() };
}
export async function migrate(db: Database) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS players (wallet TEXT PRIMARY KEY, name TEXT NOT NULL, created_at BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, wallet TEXT NOT NULL, message TEXT NOT NULL, expires_at BIGINT NOT NULL, consumed BOOLEAN NOT NULL DEFAULT FALSE)`,
    `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, wallet TEXT NOT NULL REFERENCES players(wallet), expires_at BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), data JSONB NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS rounds (id TEXT PRIMARY KEY, number BIGSERIAL UNIQUE, status TEXT NOT NULL, data JSONB NOT NULL, created_at BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS entries (round_id TEXT REFERENCES rounds(id), wallet TEXT REFERENCES players(wallet), score INTEGER NOT NULL DEFAULT 0, shots INTEGER NOT NULL DEFAULT 0, disqualified BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY(round_id,wallet))`,
    `CREATE TABLE IF NOT EXISTS shots (round_id TEXT NOT NULL, wallet TEXT NOT NULL, target_id TEXT NOT NULL, x DOUBLE PRECISION NOT NULL, y DOUBLE PRECISION NOT NULL, score INTEGER NOT NULL, received_at BIGINT NOT NULL, latency DOUBLE PRECISION NOT NULL, PRIMARY KEY(round_id,wallet,target_id), FOREIGN KEY(round_id,wallet) REFERENCES entries(round_id,wallet))`,
    `CREATE TABLE IF NOT EXISTS prizes (id TEXT PRIMARY KEY, mint TEXT NOT NULL UNIQUE, data JSONB NOT NULL, round_id TEXT, winner TEXT, status TEXT NOT NULL, transfer_signature TEXT)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS one_award_per_round ON prizes(round_id) WHERE winner IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, data JSONB NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, error TEXT)`,
    `CREATE TABLE IF NOT EXISTS ledger (id TEXT PRIMARY KEY, kind TEXT NOT NULL, amount_micros BIGINT NOT NULL, signature TEXT, created_at BIGINT NOT NULL, data JSONB NOT NULL DEFAULT '{}')`,
    `CREATE TABLE IF NOT EXISTS audit (id BIGSERIAL PRIMARY KEY, event TEXT NOT NULL, data JSONB NOT NULL, created_at BIGINT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS ledger_time ON ledger(created_at)`,
    `CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)`,
  ];
  for (const statement of statements) await db.query(statement);
}
export class Serial {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn); this.tail = next.catch(() => {}); return next;
  }
}
export async function atomic<T>(db: Database, fn: () => Promise<T>) { await db.query('BEGIN'); try { const result = await fn(); await db.query('COMMIT'); return result; } catch (error) { await db.query('ROLLBACK'); throw error; } }
export const audit = (db: Database, event: string, data: unknown) => db.query('INSERT INTO audit(event,data,created_at) VALUES($1,$2,$3)', [event, JSON.stringify(data), Date.now()]);
