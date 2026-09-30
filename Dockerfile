# syntax = docker/dockerfile:1

# Multi-stage: build the Astro app with dev dependencies available, then run
# it from a slim image carrying only the built output and prod deps. The
# fixed shape (fly.toml) is 0.0.0.0:$PORT and one persistent volume at
# /data; @astrojs/node's standalone server reads HOST/PORT itself.

FROM node:24.21.0-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24.21.0-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/db ./db
COPY README.md ./README.md
EXPOSE 8080
CMD ["node", "./dist/server/entry.mjs"]
