# Build from services/ directory:
#   docker build -f svc-schema/Dockerfile -t svc-schema .
#   docker build -f svc-schema/Dockerfile --target dev -t svc-schema:dev .

# ── development ────────────────────────────────────────────────────────────
FROM node:22-alpine AS dev
WORKDIR /app

COPY package.json                  ./
COPY shared/package.json           ./shared/package.json
COPY svc-schema/package.json       ./svc-schema/package.json
RUN npm install --workspace=@shexmap/shared --workspace=@shexmap/svc-schema

COPY shared/src/           ./shared/src/
COPY shared/tsconfig.json  ./shared/tsconfig.json
RUN npm run build --workspace=@shexmap/shared

COPY svc-schema/src/          ./svc-schema/src/
COPY svc-schema/tsconfig.json  ./svc-schema/tsconfig.json
COPY shared/proto/            ./shared/proto/

WORKDIR /app/svc-schema
EXPOSE 50000
ENV NODE_ENV=development
CMD ["npx", "tsx", "watch", "src/index.ts"]

# ── builder ────────────────────────────────────────────────────────────────
FROM dev AS builder
WORKDIR /app/svc-schema
RUN npx tsc

# ── production ─────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

COPY package.json                  ./
COPY shared/package.json           ./shared/package.json
COPY svc-schema/package.json       ./svc-schema/package.json
RUN npm install --workspace=@shexmap/shared --workspace=@shexmap/svc-schema --omit=dev

COPY --from=builder /app/shared/dist     ./shared/dist/
COPY --from=builder /app/svc-schema/dist ./svc-schema/dist/
COPY shared/proto/                       ./shared/proto/

WORKDIR /app/svc-schema
EXPOSE 50000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
