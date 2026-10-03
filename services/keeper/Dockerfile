# ThawGate keeper. Build from the repo root: docker build -f services/keeper/Dockerfile .
# No Postgres or Redis: the holder index lives in memory and is rebuilt from the chain at start.
FROM node:22-slim AS builder
# The keeper reads gate logs through @thawgate/sdk's "reasons" entry (src/gate/reasons.ts), which has no imports.
# Compile just that file (CommonJS + types, what the keeper's require and tsc need) instead of installing the whole
# SDK's Solana and test dependencies.
WORKDIR /app/sdk
COPY sdk/package.json ./
COPY sdk/src/gate/reasons.ts ./src/gate/reasons.ts
RUN npx --yes -p typescript@5.9.3 tsc src/gate/reasons.ts --outDir dist --declaration --module commonjs --target es2022 --strict
WORKDIR /app/services/keeper
COPY services/keeper/package.json ./
# In the yarn workspace the SDK is linked by version; here it comes from the folder above.
RUN node -e "const p = require('./package.json'); p.dependencies['@thawgate/sdk'] = 'file:../../sdk'; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2))"
# --legacy-peer-deps: npm 10's arborist crashes resolving these @solana/* peer sets ("Cannot read properties of null
# (reading 'edgesOut')" in #loadPeerSet, Full CI on 25dc202). The resulting tree builds and runs (S8 smoke test).
RUN npm install --no-audit --no-fund --legacy-peer-deps
COPY services/keeper/tsconfig.json ./
COPY services/keeper/src ./src
RUN npm run build && npm prune --omit=dev --legacy-peer-deps

FROM node:22-slim
ENV NODE_ENV=production PORT=3005
WORKDIR /app/services/keeper
COPY --from=builder /app/sdk/package.json /app/sdk/package.json
COPY --from=builder /app/sdk/dist /app/sdk/dist
COPY --from=builder /app/services/keeper/package.json ./
COPY --from=builder /app/services/keeper/node_modules ./node_modules
COPY --from=builder /app/services/keeper/dist ./dist
# node_modules/@thawgate/sdk is a relative symlink to /app/sdk: fail the build here if it doesn't resolve.
RUN node -e "require('@thawgate/sdk/reasons').classifyGateLogs"
USER node
EXPOSE 3005
CMD ["node", "dist/main.js"]
