# Build from services/ directory:
#   docker build -f svc-pairing/Dockerfile -t svc-pairing .
#   docker build -f svc-pairing/Dockerfile --target dev -t svc-pairing:dev .

# ── development ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS dev
WORKDIR /app

COPY package.json                  ./
COPY shared/package.json           ./shared/package.json
COPY svc-pairing/package.json      ./svc-pairing/package.json
RUN npm install --workspace=@shexmap/shared --workspace=@shexmap/svc-pairing

COPY shared/src/           ./shared/src/
COPY shared/tsconfig.json  ./shared/tsconfig.json
RUN npm run build --workspace=@shexmap/shared

COPY svc-pairing/src/          ./svc-pairing/src/
COPY svc-pairing/tsconfig.json  ./svc-pairing/tsconfig.json
COPY shared/proto/             ./svc-pairing/proto/

WORKDIR /app/svc-pairing
EXPOSE 50000
ENV NODE_ENV=development
CMD ["npx", "tsx", "watch", "src/index.ts"]

# ── builder ────────────────────────────────────────────────────────────────────
FROM dev AS builder
WORKDIR /app/svc-pairing
RUN npx tsc

# ── production ─────────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

COPY package.json                  ./
COPY shared/package.json           ./shared/package.json
COPY svc-pairing/package.json      ./svc-pairing/package.json
RUN npm install --workspace=@shexmap/shared --workspace=@shexmap/svc-pairing --omit=dev

COPY --from=builder /app/shared/dist      ./shared/dist/
COPY --from=builder /app/svc-pairing/dist ./svc-pairing/dist/
COPY shared/proto/                        ./svc-pairing/proto/

WORKDIR /app/svc-pairing
EXPOSE 50000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
