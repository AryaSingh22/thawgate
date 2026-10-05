FROM node:20-slim AS builder
WORKDIR /app
COPY services/shared ./services/shared
COPY services/webhook-service ./services/webhook-service
WORKDIR /app/services/shared
RUN npm install && npm run build 2>/dev/null || true
WORKDIR /app/services/webhook-service
# In the yarn workspace shared is linked by version; here npm links the directory.
RUN node -e "const p = require('./package.json'); p.dependencies['@thawgate/shared'] = 'file:../shared'; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2))"
RUN npm install && npm run build

FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/services/shared ./services/shared
COPY --from=builder /app/services/webhook-service/dist ./services/webhook-service/dist
COPY --from=builder /app/services/webhook-service/node_modules ./services/webhook-service/node_modules
COPY --from=builder /app/services/webhook-service/package.json ./services/webhook-service/
RUN cd services/shared && npx prisma generate
EXPOSE 3004
WORKDIR /app/services/webhook-service
CMD ["node", "dist/index.js"]
