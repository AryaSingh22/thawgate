FROM node:20-slim AS builder
WORKDIR /app
COPY services/shared ./services/shared
COPY services/mint-service ./services/mint-service
# @thawgate/sdk builds mint_tokens / burn_tokens. Build and pack it; mint-service installs the tarball as a real
# package with its dependencies (shared stays a symlink, where `prisma generate` writes its client).
COPY sdk/package.json sdk/tsconfig.json sdk/tsup.config.ts ./sdk/
COPY sdk/src ./sdk/src
WORKDIR /app/sdk
RUN npm install --no-audit --no-fund --legacy-peer-deps && npm run build && npm pack --pack-destination /tmp
WORKDIR /app/services/shared
RUN npm install && npm run build 2>/dev/null || true
WORKDIR /app/services/mint-service
# In the yarn workspace the SDK is linked by version; here it is the tarball packed above.
RUN node -e "const p = require('./package.json'); p.dependencies['@thawgate/sdk'] = 'file:/tmp/thawgate-sdk-0.1.0.tgz'; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2))"
RUN npm install && npm run build

FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/services/shared ./services/shared
COPY --from=builder /app/services/mint-service/dist ./services/mint-service/dist
COPY --from=builder /app/services/mint-service/node_modules ./services/mint-service/node_modules
COPY --from=builder /app/services/mint-service/package.json ./services/mint-service/
RUN cd services/shared && npx prisma generate
# Fail the build if the SDK didn't land as a package.
RUN cd services/mint-service && node -e "require('@thawgate/sdk').SolanaStablecoin"
EXPOSE 3001
WORKDIR /app/services/mint-service
CMD ["node", "dist/index.js"]
