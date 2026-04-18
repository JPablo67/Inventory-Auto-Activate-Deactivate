# syntax=docker/dockerfile:1

# ─── Stage 1: builder ──────────────────────────────────────────────
# Includes devDependencies so Vite can build and Prisma can generate.
# Nothing from this stage ships in the final image except the build
# output (./build) and static assets — see the runtime stage below.
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

# Manifest-only copy keeps this layer cached across source changes.
COPY package.json package-lock.json* .npmrc ./
RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

# ─── Stage 2: runtime ──────────────────────────────────────────────
# Production-only deps + build artifacts. No source, no devDependencies,
# no git history, no editor configs (those are filtered by .dockerignore
# from the build context anyway, but the multi-stage split is what
# guarantees they can never reach the runtime image).
FROM node:20-alpine AS runtime

RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production
EXPOSE 3000

# Install only prod deps. `prisma` (CLI for `migrate deploy`) and
# `@remix-run/serve` live in `dependencies`, so they're available here.
# `prisma/` is copied first because @prisma/client's postinstall hook
# runs `prisma generate` against the schema during install.
COPY package.json package-lock.json* .npmrc ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/build ./build
COPY --from=builder /app/public ./public

# Probe /health (uses busybox wget, present in node:alpine). Failure means the
# event loop is hung or the DB connection is dead — Docker will mark unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1

# `npm run docker-start` = `prisma generate && prisma migrate deploy && remix-serve`.
# Migrations apply on every container start (idempotent).
CMD ["npm", "run", "docker-start"]
