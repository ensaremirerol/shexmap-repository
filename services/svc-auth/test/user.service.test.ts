import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { setDb } from '../src/db.js';
import { registerUser, findUserByUsername, verifyPassword, upsertUser, getUserById } from '../src/services/user.service.js';
import { sparqlSelect, sparqlUpdate } from '@shexmap/shared';
import { buildPrefixes } from '@shexmap/shared';

vi.mock('@shexmap/shared', () => ({
  sparqlSelect: vi.fn(),
  sparqlUpdate: vi.fn().mockResolvedValue(undefined),
  buildPrefixes: vi.fn().mockReturnValue({}),
  createSparqlClient: vi.fn(),
}));

const mockClient = {} as any;
const mockPrefixes = buildPrefixes();

// Use an in-memory SQLite database for all tests
beforeAll(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE local_users (
      id           TEXT PRIMARY KEY,
      username     TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email        TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL
    );
    CREATE TABLE api_keys (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      name       TEXT NOT NULL,
      key_hash   TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES local_users(id) ON DELETE CASCADE
    );
  `);
  setDb(db);
});

beforeEach(() => vi.clearAllMocks());

describe('registerUser', () => {
  it('creates user in SQLite and mirrors to triple store', async () => {
    const user = await registerUser(mockClient, mockPrefixes, 'alice', 'password123', 'alice@example.com');

    expect(user.username).toBe('alice');
    expect(user.externalId).toBe('local:alice');
    expect(sparqlUpdate).toHaveBeenCalledOnce();

    const stored = await findUserByUsername('alice');
    expect(stored).not.toBeNull();
    expect(stored!.email).toBe('alice@example.com');
  });

  it('throws USERNAME_TAKEN when username is already registered', async () => {
    await expect(
      registerUser(mockClient, mockPrefixes, 'alice', 'password123', ''),
    ).rejects.toMatchObject({ code: 'USERNAME_TAKEN' });
  });
});

describe('findUserByUsername', () => {
  it('returns null for unknown username', async () => {
    expect(await findUserByUsername('nobody')).toBeNull();
  });

  it('returns user with passwordHash for known username', async () => {
    const user = await findUserByUsername('alice');
    expect(user).not.toBeNull();
    expect(user!.passwordHash).toBeTruthy();
  });
});

describe('verifyPassword', () => {
  it('returns false for wrong password', async () => {
    const user = await findUserByUsername('alice');
    expect(await verifyPassword('wrongpass', user!.passwordHash)).toBe(false);
  });

  it('returns true for correct password', async () => {
    const user = await findUserByUsername('alice');
    expect(await verifyPassword('password123', user!.passwordHash)).toBe(true);
  });
});

describe('upsertUser (OAuth)', () => {
  it('creates new OAuth user in triple store only', async () => {
    vi.mocked(sparqlSelect).mockResolvedValueOnce([]);

    const user = await upsertUser(mockClient, mockPrefixes, 'github:99', 'Bob', 'bob@example.com');

    expect(user.name).toBe('Bob');
    expect(sparqlUpdate).toHaveBeenCalledOnce();
  });

  it('returns existing user without inserting', async () => {
    vi.mocked(sparqlSelect).mockResolvedValueOnce([{
      id:      { value: 'https://w3id.org/shexmap/resource/user/abc123', type: 'uri' },
      name:    { value: 'Alice', type: 'literal' },
      email:   { value: 'alice@example.com', type: 'literal' },
      created: { value: '2024-01-01T00:00:00Z', type: 'literal' },
    }]);

    const user = await upsertUser(mockClient, mockPrefixes, 'github:42', 'Alice', 'alice@example.com');

    expect(user.id).toBe('abc123');
    expect(sparqlUpdate).not.toHaveBeenCalled();
  });
});

describe('getUserById', () => {
  it('returns null when user not found', async () => {
    vi.mocked(sparqlSelect).mockResolvedValueOnce([]);
    expect(await getUserById(mockClient, mockPrefixes, 'nonexistent')).toBeNull();
  });

  it('returns user when found', async () => {
    vi.mocked(sparqlSelect).mockResolvedValueOnce([{
      name:       { value: 'Carol', type: 'literal' },
      email:      { value: 'carol@example.com', type: 'literal' },
      externalId: { value: 'orcid:0000-0001', type: 'literal' },
      created:    { value: '2024-06-01T00:00:00Z', type: 'literal' },
    }]);

    const user = await getUserById(mockClient, mockPrefixes, 'carol-id');
    expect(user).toMatchObject({ id: 'carol-id', name: 'Carol' });
  });
});
