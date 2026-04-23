# Build from services/ directory:
#   docker build -f svc-sparql-proxy/Dockerfile -t svc-sparql-proxy .
#   docker build -f svc-sparql-proxy/Dockerfile --target dev -t svc-sparql-proxy:dev .

# ── development ────────────────────────────────────────────────────────────
FROM node:22-alpine AS dev
WORKDIR /app

COPY svc-sparql-proxy/package.json ./
RUN npm install

COPY svc-sparql-proxy/src/      ./src/
COPY svc-sparql-proxy/tsconfig.json ./

EXPOSE 50000
ENV NODE_ENV=development
CMD ["npx", "tsx", "watch", "src/index.ts"]

# ── builder ────────────────────────────────────────────────────────────────
FROM dev AS builder
RUN npx tsc

# ── production ─────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY svc-sparql-proxy/package.json    ./

EXPOSE 50000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
