# One image for every server mode. MODE (or --mode=) picks what it runs.
# Builds for linux/amd64 and linux/arm64 (Oracle Ampere) with docker buildx.

FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm -r build \
 && pnpm --filter @reaplift/server deploy --prod --legacy /out

FROM node:22-slim AS runtime
# The commit the image was built from; /healthz reports it, so a deploy can tell the new version is live.
ARG APP_VERSION=dev
ENV NODE_ENV=production MIGRATIONS_DIR=/app/db/migrations UPLOAD_DIR=/app/uploads APP_VERSION=$APP_VERSION
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/web/dist ./public
COPY db/migrations ./db/migrations
# Uploads stay on local disk until Object Storage (M10 10.5). Owned by `node`, so a volume mounted here is writable.
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
