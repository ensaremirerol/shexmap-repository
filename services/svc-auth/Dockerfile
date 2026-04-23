# Build from services/ directory:
#   docker build -f svc-auth/Dockerfile -t svc-auth .
#   docker build -f svc-auth/Dockerfile --target dev -t svc-auth:dev .

# ── development ────────────────────────────────────────────────────────────
FROM node:22-alpine AS dev
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY svc-auth/package.json ./
RUN npm install

COPY svc-auth/src/      ./src/
COPY svc-auth/tsconfig.json ./
COPY shared/proto/      ./proto/

VOLUME ["/app/data"]
EXPOSE 50000
ENV NODE_ENV=development
CMD ["npx", "tsx", "watch", "src/index.ts"]

# ── builder ────────────────────────────────────────────────────────────────
FROM dev AS builder
RUN npx tsc

# ── production ─────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Runtime deps for better-sqlite3 native module
RUN apk add --no-cache libstdc++

COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY shared/proto/                    ./proto/
COPY svc-auth/package.json            ./

VOLUME ["/app/data"]
EXPOSE 50000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
