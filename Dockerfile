# ─── Stage 1: deps ──────────────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ─── Stage 2: build ─────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm ci && npx next build

# ─── Stage 3: runtime (minimal, ~200MB) ────────────────────────
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# sharp needs these native libs on slim images
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev && rm -rf /var/lib/apt/lists/*

# Copy standalone server + static assets + public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
