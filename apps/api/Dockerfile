# Build stage: compile TS across the workspace.
FROM node:22-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /repo

# Copy workspace manifests first for better layer caching.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile --filter @speed-encode/api...

# Copy sources.
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN pnpm --filter @speed-encode/api build

# Use pnpm deploy to flatten the workspace package (resolves workspace:* deps
# into a self-contained node_modules tree).
RUN pnpm --filter @speed-encode/api --prod deploy /out

# Runtime stage: minimal image with ffmpeg.
FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3001
ENV STORAGE_DIR=/app/storage

# Fargate task definition supplies RUNWAYML_API_SECRET, MODAL_AUDIO_URL,
# PUBLIC_BASE_URL (= the ALB domain), WEB_ORIGIN.

EXPOSE 3001
CMD ["node", "dist/server.js"]
