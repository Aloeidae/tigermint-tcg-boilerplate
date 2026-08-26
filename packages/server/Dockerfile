# PvP server. Build from the REPO ROOT so the shared package is included:
#   docker build -f packages/server/Dockerfile -t tcg-server .
#   docker run -p 8081:8081 tcg-server
FROM node:20-slim
WORKDIR /app

# The server runs TypeScript directly via tsx and consumes @tcg/shared as source.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
RUN npm ci --workspace @tcg/server --workspace @tcg/shared --include-workspace-root

COPY packages/shared packages/shared
COPY packages/server packages/server

ENV PORT=8081
EXPOSE 8081
CMD ["npx", "tsx", "packages/server/src/index.ts"]
