# ThawGate keeper. Build from the repo root: docker build -f services/keeper/Dockerfile .
# No Postgres or Redis: the holder index lives in memory and is rebuilt from the chain at start.
FROM node:22-slim AS builder
WORKDIR /app/services/keeper
COPY services/keeper/package.json ./
# --legacy-peer-deps: npm 10's arborist crashes resolving these @solana/* peer sets ("Cannot read properties of null
# (reading 'edgesOut')" in #loadPeerSet, Full CI on 25dc202). The resulting tree builds and runs (S8 smoke test).
RUN npm install --no-audit --no-fund --legacy-peer-deps
COPY services/keeper/tsconfig.json ./
COPY services/keeper/src ./src
RUN npm run build && npm prune --omit=dev --legacy-peer-deps

FROM node:22-slim
ENV NODE_ENV=production PORT=3005
WORKDIR /app/services/keeper
COPY --from=builder /app/services/keeper/package.json ./
COPY --from=builder /app/services/keeper/node_modules ./node_modules
COPY --from=builder /app/services/keeper/dist ./dist
USER node
EXPOSE 3005
CMD ["node", "dist/main.js"]
