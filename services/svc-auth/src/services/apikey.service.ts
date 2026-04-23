import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import { getDb } from '../db.js';

export interface ApiKey {
  id: string;
  name: string;
  createdAt: string;
}

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function createApiKey(userId: string, name: string): { key: ApiKey; raw: string } {
  const id = uuidv4();
  const raw = randomBytes(32).toString('hex');
  const hash = hashKey(raw);
  const now = new Date().toISOString();

  getDb()
    .prepare('INSERT INTO api_keys (id, user_id, name, key_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, name, hash, now);

  return { key: { id, name, createdAt: now }, raw };
}

export function listApiKeys(userId: string): ApiKey[] {
  const rows = getDb()
    .prepare('SELECT id, name, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as Array<{ id: string; name: string; created_at: string }>;

  return rows.map(r => ({ id: r.id, name: r.name, createdAt: r.created_at }));
}

export function revokeApiKey(userId: string, keyId: string): void {
  getDb()
    .prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?')
    .run(keyId, userId);
}

// Returns userId if the key is valid, null otherwise
export function validateApiKey(raw: string): string | null {
  const hash = hashKey(raw);
  const row = getDb()
    .prepare('SELECT user_id FROM api_keys WHERE key_hash = ?')
    .get(hash) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}
