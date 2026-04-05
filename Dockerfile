# Production image for Railway (or any Docker host). Cron runs: node dist/main.js
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/scout.sqlite
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/data
CMD ["node", "dist/main.js"]
