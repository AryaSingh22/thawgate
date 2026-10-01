# ThawGate keeper. Build from the repo root: docker build -f services/keeper/Dockerfile .
# No Postgres or Redis: the holder index lives in memory and is rebuilt from the chain at start.
FROM node:22-slim AS builder
WORKDIR /app/services/keeper
COPY services/keeper/package.json ./
RUN npm install --no-audit --no-fund
COPY services/keeper/tsconfig.json ./
COPY services/keeper/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production PORT=3005
WORKDIR /app/services/keeper
COPY --from=builder /app/services/keeper/package.json ./
COPY --from=builder /app/services/keeper/node_modules ./node_modules
COPY --from=builder /app/services/keeper/dist ./dist
USER node
EXPOSE 3005
CMD ["node", "dist/main.js"]
