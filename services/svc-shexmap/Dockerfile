# Build from services/ directory:
#   docker build -f svc-shexmap/Dockerfile -t svc-shexmap .
#   docker build -f svc-shexmap/Dockerfile --target dev -t svc-shexmap:dev .

# ── development ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS dev
WORKDIR /app

COPY svc-shexmap/package.json ./
RUN npm install

COPY svc-shexmap/src/      ./src/
COPY svc-shexmap/tsconfig.json ./
COPY shared/proto/          ./proto/

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
COPY svc-shexmap/package.json         ./

EXPOSE 50000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
