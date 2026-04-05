# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
COPY apps/sp-api/package.json apps/sp-api/package.json
COPY apps/sp-web/package.json apps/sp-web/package.json
RUN corepack enable && pnpm install --frozen-lockfile
RUN DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sp?schema=public \
  ./node_modules/.bin/prisma generate --schema /app/prisma/schema.prisma

FROM deps AS build
COPY . .
RUN pnpm --filter sp-api build
RUN pnpm --filter sp-web build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl
RUN mkdir -p /var/lib/stasharr && chmod 700 /var/lib/stasharr
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/sp-api/package.json ./apps/sp-api/package.json
COPY --from=build /app/apps/sp-api/node_modules ./apps/sp-api/node_modules
COPY --from=build /app/apps/sp-api/dist ./apps/sp-api/dist
COPY --from=build /app/apps/sp-web/dist ./apps/sp-web/dist
COPY --from=build /app/prisma ./prisma
COPY infrastructure/docker/healthcheck.mjs /usr/local/bin/healthcheck.mjs
COPY infrastructure/docker/start-app.sh /usr/local/bin/start-app
RUN chmod +x /usr/local/bin/start-app
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 CMD ["node", "/usr/local/bin/healthcheck.mjs"]
EXPOSE 3000
CMD ["start-app"]
