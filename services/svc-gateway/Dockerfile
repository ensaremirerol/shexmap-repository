# Build from services/ directory:
#   docker build -f svc-gateway/Dockerfile -t svc-gateway .
#   docker build -f svc-gateway/Dockerfile --target dev -t svc-gateway:dev .

# ── development ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS dev
WORKDIR /app

COPY svc-gateway/package.json ./
RUN npm install

COPY svc-gateway/src/      ./src/
COPY svc-gateway/tsconfig.json ./
COPY shared/proto/      ./proto/

EXPOSE 50000
ENV NODE_ENV=development
CMD ["npx", "tsx", "watch", "src/index.ts"]

# ── builder ────────────────────────────────────────────────────────────────────
FROM dev AS builder
RUN npx tsc

# ── production ─────────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY shared/proto/                    ./proto/
COPY svc-gateway/package.json         ./

EXPOSE 50000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
