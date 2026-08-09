FROM oven/bun:1.3.8-alpine

WORKDIR /app

COPY apps/gateway/package.json package.json
COPY apps/gateway/bun.docker.lock bun.lock
RUN bun install --frozen-lockfile --production

COPY apps/gateway/src src
COPY apps/gateway/migrations migrations

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER bun
CMD ["bun", "run", "src/index.ts"]
