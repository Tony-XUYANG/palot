FROM oven/bun:1.3.8-alpine

WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY apps/gateway/package.json apps/gateway/package.json
RUN bun install --frozen-lockfile --production

COPY apps/gateway apps/gateway
WORKDIR /app/apps/gateway

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER bun
CMD ["bun", "run", "src/index.ts"]
