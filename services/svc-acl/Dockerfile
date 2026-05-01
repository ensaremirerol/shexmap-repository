# Build from services/ directory:
#   docker build -f svc-acl/Dockerfile -t svc-acl .
#   docker build -f svc-acl/Dockerfile --target dev -t svc-acl:dev .

# ── development ────────────────────────────────────────────────────────────
FROM node:22-alpine AS dev
WORKDIR /app

COPY package.json                  ./
COPY shared/package.json           ./shared/package.json
COPY svc-acl/package.json          ./svc-acl/package.json
RUN npm install --workspace=@shexmap/shared --workspace=@shexmap/svc-acl

COPY shared/src/           ./shared/src/
COPY shared/tsconfig.json  ./shared/tsconfig.json
RUN npm run build --workspace=@shexmap/shared

COPY svc-acl/src/          ./svc-acl/src/
COPY svc-acl/tsconfig.json ./svc-acl/tsconfig.json
COPY shared/proto/         ./shared/proto/

WORKDIR /app/svc-acl
EXPOSE 50000
ENV NODE_ENV=development
CMD ["npx", "tsx", "watch", "src/index.ts"]

# ── builder ────────────────────────────────────────────────────────────────
FROM dev AS builder
WORKDIR /app/svc-acl
RUN npx tsc

# ── production ─────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

COPY package.json                  ./
COPY shared/package.json           ./shared/package.json
COPY svc-acl/package.json          ./svc-acl/package.json
RUN npm install --workspace=@shexmap/shared --workspace=@shexmap/svc-acl --omit=dev

COPY --from=builder /app/shared/dist  ./shared/dist/
COPY --from=builder /app/svc-acl/dist ./svc-acl/dist/
COPY shared/proto/                    ./shared/proto/

WORKDIR /app/svc-acl
EXPOSE 50000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
