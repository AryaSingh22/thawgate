FROM node:20-slim AS builder
WORKDIR /app
COPY services/shared ./services/shared
COPY services/compliance-service ./services/compliance-service
WORKDIR /app/services/shared
RUN npm install && npm run build 2>/dev/null || true
WORKDIR /app/services/compliance-service
# In the yarn workspace shared is linked by version; here npm links the directory.
RUN node -e "const p = require('./package.json'); p.dependencies['@thawgate/shared'] = 'file:../shared'; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2))"
RUN npm install && npm run build

FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/services/shared ./services/shared
COPY --from=builder /app/services/compliance-service/dist ./services/compliance-service/dist
COPY --from=builder /app/services/compliance-service/node_modules ./services/compliance-service/node_modules
COPY --from=builder /app/services/compliance-service/package.json ./services/compliance-service/
# The sanctions screener's default static list (CMD ["node", "dist/screener/main.js"] runs the screener instead).
COPY --from=builder /app/services/compliance-service/lists ./services/compliance-service/lists
RUN cd services/shared && npx prisma generate
EXPOSE 3003
WORKDIR /app/services/compliance-service
CMD ["node", "dist/index.js"]
