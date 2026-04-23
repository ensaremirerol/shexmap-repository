import { sparqlSelect, sparqlUpdate } from '@shexmap/shared';
import type { Prefixes, createSparqlClient } from '@shexmap/shared';
type SimpleClient = ReturnType<typeof createSparqlClient>;
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
const { hash: bcryptHash, compare: bcryptCompare } = bcrypt;
import { getDb } from '../db.js';

const BCRYPT_ROUNDS = 12;

export interface User {
  id: string;
  name: string;
  email: string;
  externalId: string;
  created: string;
}

export interface LocalUser extends User {
  username: string;
}

// ── Local (username/password) users — stored in SQLite ─────────────────────

export async function registerUser(
  _client: SimpleClient,
  prefixes: Prefixes,
  username: string,
  password: string,
  email: string,
): Promise<LocalUser> {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM local_users WHERE username = ?').get(username);
  if (existing) throw Object.assign(new Error('Username already taken'), { code: 'USERNAME_TAKEN' });

  const id = uuidv4();
  const now = new Date().toISOString();
  const passwordHash = await bcryptHash(password, BCRYPT_ROUNDS);

  db.prepare(
    'INSERT INTO local_users (id, username, password_hash, email, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, username, passwordHash, email, now);

  // Mirror public profile in triple store for discoverability
  await sparqlUpdate(_client, prefixes, `
    INSERT DATA {
      shexruser:${id} a schema:Person ;
        schema:name ${JSON.stringify(username)} ;
        schema:email ${JSON.stringify(email)} ;
        dct:identifier "local:${username}" ;
        dct:created "${now}"^^xsd:dateTime .
    }
  `);

  return { id, name: username, email, externalId: `local:${username}`, username, created: now };
}

export async function findUserByUsername(
  username: string,
): Promise<(LocalUser & { passwordHash: string }) | null> {
  const row = getDb()
    .prepare('SELECT id, email, password_hash, created_at FROM local_users WHERE username = ?')
    .get(username) as { id: string; email: string; password_hash: string; created_at: string } | undefined;

  if (!row) return null;
  return {
    id:           row.id,
    name:         username,
    email:        row.email,
    externalId:   `local:${username}`,
    username,
    created:      row.created_at,
    passwordHash: row.password_hash,
  };
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcryptCompare(plain, hash);
}

// ── OAuth users — stored only in triple store (no credentials) ──────────────

export async function upsertUser(
  client: SimpleClient,
  prefixes: Prefixes,
  externalId: string,
  name: string,
  email: string,
): Promise<User> {
  const existing = await sparqlSelect(client, prefixes, `
    SELECT ?id ?name ?email ?created WHERE {
      ?id a schema:Person ;
          dct:identifier ${JSON.stringify(externalId)} ;
          schema:name ?name ;
          schema:email ?email ;
          dct:created ?created .
    } LIMIT 1
  `);

  if (existing.length > 0) {
    const row = existing[0];
    return {
      id:         row['id'].value.split('/').pop()!,
      name:       row['name'].value,
      email:      row['email'].value,
      externalId,
      created:    row['created'].value,
    };
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  await sparqlUpdate(client, prefixes, `
    INSERT DATA {
      shexruser:${id} a schema:Person ;
        schema:name ${JSON.stringify(name)} ;
        schema:email ${JSON.stringify(email)} ;
        dct:identifier ${JSON.stringify(externalId)} ;
        dct:created "${now}"^^xsd:dateTime .
    }
  `);

  return { id, name, email, externalId, created: now };
}

// ── Public profile lookup — triple store ────────────────────────────────────

export async function getUserById(
  client: SimpleClient,
  prefixes: Prefixes,
  userId: string,
): Promise<User | null> {
  const rows = await sparqlSelect(client, prefixes, `
    SELECT ?name ?email ?externalId ?created WHERE {
      shexruser:${userId} a schema:Person ;
        schema:name ?name ;
        schema:email ?email ;
        dct:identifier ?externalId ;
        dct:created ?created .
    } LIMIT 1
  `);

  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id:         userId,
    name:       row['name'].value,
    email:      row['email'].value,
    externalId: row['externalId'].value,
    created:    row['created'].value,
  };
}
