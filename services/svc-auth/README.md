# svc-auth

Authentication and user management service for ShExMap. Handles username/password login, GitHub/Google/ORCID OAuth, JWT issuance, and API key management.

**Port:** 3006 (HTTP — OAuth callbacks require HTTP redirects)

---

## Quick start (dev)

```bash
# From the repo root
cp .env.example .env          # set JWT_SECRET and any OAuth credentials
npm install                   # installs all workspaces including shared

cd services/svc-auth
npm run dev                   # tsx watch — hot reload on :3006
```

The SQLite database is created automatically at `./data/auth.db` on first start.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3006` | HTTP port |
| `AUTH_ENABLED` | `false` | Set to `true` to enforce authentication |
| `JWT_SECRET` | `dev-secret-…` | **Must be changed in production.** Shared with svc-gateway for verification. |
| `JWT_EXPIRY` | `86400` | Token lifetime in seconds (24 h) |
| `SQLITE_PATH` | `./data/auth.db` | Path to the SQLite database file |
| `OAUTH_CALLBACK_BASE_URL` | `http://localhost` | Public base URL the OAuth provider redirects back to (e.g. `https://shexmap.example.com`) |
| `OAUTH_GITHUB_CLIENT_ID` | — | GitHub OAuth app client ID |
| `OAUTH_GITHUB_CLIENT_SECRET` | — | GitHub OAuth app client secret |
| `OAUTH_GOOGLE_CLIENT_ID` | — | Google OAuth app client ID |
| `OAUTH_GOOGLE_CLIENT_SECRET` | — | Google OAuth app client secret |
| `OAUTH_ORCID_CLIENT_ID` | — | ORCID OAuth client ID |
| `OAUTH_ORCID_CLIENT_SECRET` | — | ORCID OAuth client secret |
| `QLEVER_SPARQL_URL` | `http://qlever:7001/sparql` | QLever SELECT endpoint |
| `QLEVER_UPDATE_URL` | `http://qlever:7001/update` | QLever UPDATE endpoint |
| `QLEVER_ACCESS_TOKEN` | — | Bearer token for QLever (if required) |
| `LOG_LEVEL` | `info` | Pino log level |
| `BASE_NAMESPACE` | `https://w3id.org/shexmap/` | RDF namespace base |

---

## Data model

Two stores are used, each holding the data it is best suited for:

### SQLite (`SQLITE_PATH`) — private / auth data

| Table | Columns | Purpose |
|---|---|---|
| `local_users` | `id, username, password_hash, email, created_at` | Username/password accounts. Password is bcrypt-hashed (cost 12). Never exposed via API. |
| `api_keys` | `id, user_id, name, key_hash, created_at` | API keys. Only the SHA-256 hash of the raw key is stored. The raw key is shown once on creation. |

### QLever triple store — public profile data

Every user (local or OAuth) gets a `schema:Person` node in QLever:

```turtle
shexruser:<uuid> a schema:Person ;
  schema:name   "Alice" ;
  schema:email  "alice@example.com" ;
  dct:identifier "local:alice" ;   # or "github:12345", "google:…", "orcid:…"
  dct:created   "2024-01-01T00:00:00Z"^^xsd:dateTime .
```

This record is what other services (svc-shexmap, svc-pairing, …) use to attribute contributions. It contains no credentials.

---

## GitHub OAuth setup

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set **Authorization callback URL** to:
   ```
   <OAUTH_CALLBACK_BASE_URL>/auth/callback?provider=github
   ```
   For local dev: `http://localhost:3006/auth/callback?provider=github`
3. Copy the **Client ID** and generate a **Client Secret**.
4. Add to `.env`:
   ```
   OAUTH_GITHUB_CLIENT_ID=<id>
   OAUTH_GITHUB_CLIENT_SECRET=<secret>
   AUTH_ENABLED=true
   ```

The same pattern applies for Google (Google Cloud Console → OAuth 2.0 Client IDs) and ORCID (ORCID Developer Tools → Register a public API client).

---

## API reference

All routes are under `http://localhost:3006` in dev, or proxied via svc-gateway at `/api/v1/auth` and `/api/v1/users` in production.

### Auth

| Method | Path | Auth required | Description |
|---|---|---|---|
| `GET` | `/auth/status` | No | Returns `{ enabled, authenticated, user }` |
| `POST` | `/auth/register` | No | Register with `{ username, password, email? }`. Returns `{ token, user }`. |
| `POST` | `/auth/login` | No | Login with `{ username, password }`. Returns `{ token, user }`. |
| `GET` | `/auth/login?provider=github` | No | Redirect to GitHub OAuth flow. |
| `GET` | `/auth/callback?provider=github` | No | OAuth callback — exchanges code, issues JWT, redirects to SPA with `#token=…`. |
| `POST` | `/auth/logout` | JWT | Confirms logout (client drops the JWT). |

### Users

| Method | Path | Auth required | Description |
|---|---|---|---|
| `GET` | `/users/:userId/dashboard` | JWT (own or admin) | User's contributions and starred items. |
| `GET` | `/users/:userId/shexmaps` | No | User's public ShExMap list. |
| `POST` | `/users/:userId/api-keys` | JWT (own or admin) | Create API key. Returns `{ id, name, createdAt, key }` — `key` shown once. |
| `GET` | `/users/:userId/api-keys` | JWT (own or admin) | List API keys (hashes not returned). |
| `DELETE` | `/users/:userId/api-keys/:keyId` | JWT (own or admin) | Revoke an API key. |

### Authenticating with an API key

Pass the raw key in the `X-API-Key` header instead of `Authorization: Bearer <jwt>`:

```
X-API-Key: <raw-key-returned-on-creation>
```

---

## Docker

Build and run from the `services/` directory:

```bash
# Production image
docker build -f svc-auth/Dockerfile -t svc-auth .
docker run -p 3006:3006 \
  -e AUTH_ENABLED=true \
  -e JWT_SECRET=<secret> \
  -e OAUTH_GITHUB_CLIENT_ID=<id> \
  -e OAUTH_GITHUB_CLIENT_SECRET=<secret> \
  -e OAUTH_CALLBACK_BASE_URL=https://shexmap.example.com \
  -v svc-auth-data:/app/data \
  svc-auth

# Dev image (hot reload)
docker build -f svc-auth/Dockerfile --target dev -t svc-auth:dev .
```

Mount `/app/data` as a volume to persist the SQLite database across container restarts.

In the full compose stack, svc-auth is already wired up — just set the environment variables in `.env`.

---

## Tests

```bash
npm test          # run once
npm run test:watch  # watch mode
```

Tests use an in-memory SQLite database (injected via `setDb`) and mock the SPARQL client, so no running QLever is required.
