# Build from services/ directory:
#   docker build -f svc-coverage/Dockerfile -t svc-coverage .
#   docker build -f svc-coverage/Dockerfile --target dev -t svc-coverage:dev .

# ── development ────────────────────────────────────────────────────────────
FROM node:22-alpine AS dev
WORKDIR /app

COPY package.json                   ./
COPY shared/package.json            ./shared/package.json
COPY svc-coverage/package.json      ./svc-coverage/package.json
RUN npm install --workspace=@shexmap/shared --workspace=@shexmap/svc-coverage

COPY shared/src/           ./shared/src/
COPY shared/tsconfig.json  ./shared/tsconfig.json
RUN npm run build --workspace=@shexmap/shared

COPY svc-coverage/src/          ./svc-coverage/src/
COPY svc-coverage/tsconfig.json  ./svc-coverage/tsconfig.json
COPY shared/proto/              ./shared/proto/

WORKDIR /app/svc-coverage
EXPOSE 50000
ENV NODE_ENV=development
CMD ["npx", "tsx", "watch", "src/index.ts"]

# ── builder ────────────────────────────────────────────────────────────────
FROM dev AS builder
WORKDIR /app/svc-coverage
RUN npx tsc

# ── production ─────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

COPY package.json                   ./
COPY shared/package.json            ./shared/package.json
COPY svc-coverage/package.json      ./svc-coverage/package.json
RUN npm install --workspace=@shexmap/shared --workspace=@shexmap/svc-coverage --omit=dev

COPY --from=builder /app/shared/dist       ./shared/dist/
COPY --from=builder /app/svc-coverage/dist ./svc-coverage/dist/
COPY shared/proto/                         ./shared/proto/

WORKDIR /app/svc-coverage
EXPOSE 50000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
