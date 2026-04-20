# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY services/shared/package.json ./services/shared/
COPY services/svc-validate/package.json ./services/svc-validate/
COPY package.json ./
RUN npm install --workspace=services/svc-validate

COPY services/shared ./services/shared
COPY services/svc-validate/tsconfig.json ./services/svc-validate/
COPY services/svc-validate/src ./services/svc-validate/src

WORKDIR /app/services/svc-validate
RUN npm run build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY services/shared/package.json ./services/shared/
COPY services/svc-validate/package.json ./services/svc-validate/
COPY package.json ./
RUN npm install --workspace=services/svc-validate --omit=dev

COPY --from=builder /app/services/svc-validate/dist ./services/svc-validate/dist
COPY services/shared/proto ./services/shared/proto

WORKDIR /app/services/svc-validate
EXPOSE 50051
CMD ["node", "dist/index.js"]
