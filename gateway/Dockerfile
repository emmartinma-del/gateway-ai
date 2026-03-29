FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
# Prune devDependencies after build
RUN npm prune --omit=dev

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# Copy built artifacts and production node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Persistent volume mount point for SQLite database
RUN mkdir -p /data
ENV DATABASE_PATH=/data/gateway.db
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "--experimental-sqlite", "dist/index.js"]
