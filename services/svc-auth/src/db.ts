import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from './config.js';

let _db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (!_db) {
    mkdirSync(dirname(config.sqlitePath), { recursive: true });
    _db = new Database(config.sqlitePath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    migrate(_db);
  }
  return _db;
}

// For tests: inject a pre-configured in-memory database
export function setDb(db: Database.Database): void {
  _db = db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_users (
      id           TEXT PRIMARY KEY,
      username     TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email        TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      name       TEXT NOT NULL,
      key_hash   TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES local_users(id) ON DELETE CASCADE
    );
  `);
}
