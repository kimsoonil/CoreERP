FROM node:24-alpine
WORKDIR /app/tools
COPY tools/package*.json ./
RUN npm ci --omit=dev
COPY tools/benchmark.mjs ./
COPY backend/src/main/resources/db/migration /app/backend/src/main/resources/db/migration
WORKDIR /app
CMD ["node","tools/benchmark.mjs"]
