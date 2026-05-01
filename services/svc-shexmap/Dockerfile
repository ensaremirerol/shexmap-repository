# Build from services/ directory:
#   docker build -f svc-shexmap/Dockerfile -t svc-shexmap .
#   docker build -f svc-shexmap/Dockerfile --target dev -t svc-shexmap:dev .

# ── development ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS dev
WORKDIR /app

COPY package.json                  ./
COPY shared/package.json           ./shared/package.json
COPY svc-shexmap/package.json      ./svc-shexmap/package.json
RUN npm install --workspace=@shexmap/shared --workspace=@shexmap/svc-shexmap

COPY shared/src/           ./shared/src/
COPY shared/tsconfig.json  ./shared/tsconfig.json
RUN npm run build --workspace=@shexmap/shared

COPY svc-shexmap/src/          ./svc-shexmap/src/
COPY svc-shexmap/tsconfig.json  ./svc-shexmap/tsconfig.json
COPY shared/proto/             ./shared/proto/

WORKDIR /app/svc-shexmap
EXPOSE 50000
ENV NODE_ENV=development
CMD ["npx", "tsx", "watch", "src/index.ts"]

# ── builder ────────────────────────────────────────────────────────────────────
FROM dev AS builder
WORKDIR /app/svc-shexmap
RUN npx tsc

# ── production ─────────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

COPY package.json                  ./
COPY shared/package.json           ./shared/package.json
COPY svc-shexmap/package.json      ./svc-shexmap/package.json
RUN npm install --workspace=@shexmap/shared --workspace=@shexmap/svc-shexmap --omit=dev

COPY --from=builder /app/shared/dist      ./shared/dist/
COPY --from=builder /app/svc-shexmap/dist ./svc-shexmap/dist/
COPY shared/proto/                        ./svc-shexmap/proto/

WORKDIR /app/svc-shexmap
EXPOSE 50000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
