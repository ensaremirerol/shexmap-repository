# Build from services/ directory:
#   docker build -f svc-auth/Dockerfile -t svc-auth .
#   docker build -f svc-auth/Dockerfile --target dev -t svc-auth:dev .

# ── development ────────────────────────────────────────────────────────────
FROM node:22-alpine AS dev
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json                 ./
COPY shared/package.json          ./shared/package.json
COPY svc-auth/package.json        ./svc-auth/package.json
RUN npm install --workspace=@shexmap/shared --workspace=@shexmap/svc-auth

COPY shared/src/           ./shared/src/
COPY shared/tsconfig.json  ./shared/tsconfig.json
RUN npm run build --workspace=@shexmap/shared

COPY svc-auth/src/         ./svc-auth/src/
COPY svc-auth/tsconfig.json ./svc-auth/tsconfig.json
COPY shared/proto/         ./svc-auth/proto/

WORKDIR /app/svc-auth
VOLUME ["/data"]
EXPOSE 50000
ENV NODE_ENV=development
CMD ["npx", "tsx", "watch", "src/index.ts"]

# ── builder ────────────────────────────────────────────────────────────────
FROM dev AS builder
WORKDIR /app/svc-auth
RUN npx tsc

# ── production ─────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache libstdc++

COPY package.json                 ./
COPY shared/package.json          ./shared/package.json
COPY svc-auth/package.json        ./svc-auth/package.json
RUN npm install --workspace=@shexmap/shared --workspace=@shexmap/svc-auth --omit=dev

COPY --from=builder /app/shared/dist   ./shared/dist/
COPY --from=builder /app/svc-auth/dist ./svc-auth/dist/
COPY shared/proto/                     ./svc-auth/proto/

WORKDIR /app/svc-auth
VOLUME ["/data"]
EXPOSE 50000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
