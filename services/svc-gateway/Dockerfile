# Build from services/ directory:
#   docker build -f svc-gateway/Dockerfile -t svc-gateway .
#   docker build -f svc-gateway/Dockerfile --target dev -t svc-gateway:dev .

# ── development ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS dev
WORKDIR /app

COPY package.json                   ./
COPY shared/package.json            ./shared/package.json
COPY svc-gateway/package.json       ./svc-gateway/package.json
RUN npm install --workspace=@shexmap/shared --workspace=@shexmap/svc-gateway

COPY shared/src/          ./shared/src/
COPY shared/tsconfig.json ./shared/tsconfig.json
RUN npm run build --workspace=@shexmap/shared

COPY svc-gateway/src/         ./svc-gateway/src/
COPY svc-gateway/tsconfig.json ./svc-gateway/tsconfig.json
COPY shared/proto/            ./shared/proto/

WORKDIR /app/svc-gateway
EXPOSE 50000
ENV NODE_ENV=development
CMD ["npx", "tsx", "watch", "src/index.ts"]

# ── builder ────────────────────────────────────────────────────────────────────
FROM dev AS builder
WORKDIR /app/svc-gateway
RUN npx tsc

# ── production ─────────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

COPY package.json                   ./
COPY shared/package.json            ./shared/package.json
COPY svc-gateway/package.json       ./svc-gateway/package.json
RUN npm install --workspace=@shexmap/shared --workspace=@shexmap/svc-gateway --omit=dev

COPY --from=builder /app/shared/dist      ./shared/dist/
COPY --from=builder /app/svc-gateway/dist ./svc-gateway/dist/
COPY shared/proto/                        ./shared/proto/

WORKDIR /app/svc-gateway
EXPOSE 50000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
