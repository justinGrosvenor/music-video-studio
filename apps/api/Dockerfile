# --- API build stage: compile the Fastify TS sources for the workspace.
FROM node:22-bookworm-slim AS api-build

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /repo

# Workspace manifests first for better layer caching.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile --filter @mvs/api...

COPY packages/shared packages/shared
COPY apps/api apps/api

# Build shared first so its dist/ exists; the api's tsc then resolves
# @mvs/shared via the package.json `main` (./dist/index.js) and node_modules
# at runtime can load real .js files (Node 22 refuses to type-strip files
# under node_modules, so shipping bare .ts there crashes the container).
RUN pnpm --filter @mvs/shared build
RUN pnpm --filter @mvs/api build

# pnpm deploy flattens workspace:* deps into a self-contained tree.
# pnpm v10+ requires --legacy unless inject-workspace-packages is set.
RUN pnpm --filter @mvs/api --prod --legacy deploy /out


# --- Web build stage: build the SPA (Vite) so the runtime can serve it.
FROM node:22-bookworm-slim AS web-build

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile --filter @mvs/web...

COPY packages/shared packages/shared
COPY apps/web apps/web

# Same dance as the api stage — vite build resolves @mvs/shared via the
# package.json `main`, so shared's dist must exist before the web bundle is built.
RUN pnpm --filter @mvs/shared build
RUN pnpm --filter @mvs/web build


# --- Runtime: minimal image with ffmpeg, the API bundle, and the SPA dist.
FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=api-build /out/node_modules ./node_modules
COPY --from=api-build /repo/apps/api/dist ./dist
COPY --from=api-build /repo/apps/api/package.json ./package.json
COPY --from=web-build /repo/apps/web/dist ./web

ENV NODE_ENV=production
ENV PORT=3001
ENV STORAGE_DIR=/app/storage
ENV WEB_DIST_DIR=/app/web

# Fargate task definition supplies RUNWAYML_API_SECRET, MODAL_AUDIO_URL,
# PUBLIC_BASE_URL (= the ALB / CloudFront domain), WEB_ORIGIN.

EXPOSE 3001
CMD ["node", "dist/server.js"]
