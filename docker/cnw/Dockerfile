# Codehouse Neighbourhood Watch (O41). Built from the repository root:
#   docker build -f docker/cnw/Dockerfile -t codehouse-cnw .
# The image holds CNW's server and the Codehouse interface built for remote use. It runs as an unprivileged user and
# keeps its data in /data (a volume). The build needs about 2 GB of memory (the interface's build).
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
# Every workspace's package.json, so npm ci finds the lockfile in step with them; only the three below are installed.
# apps/cnw/test/dockerfile.test.ts checks this list against the repository's workspaces.
COPY apps/approver/package.json apps/approver/
COPY apps/companion/package.json apps/companion/
COPY apps/host/package.json apps/host/
COPY apps/phone/package.json apps/phone/
COPY apps/relay/package.json apps/relay/
COPY packages/policy/package.json packages/policy/
# What the build and CNW itself use: the shared package, CNW, the interface, and the alias list its Vite config reads.
COPY scripts/workspace-aliases.mjs scripts/
COPY packages/shared packages/shared
COPY apps/cnw apps/cnw
COPY apps/web apps/web
RUN npm ci --workspace @gatehouse/cnw --workspace @gatehouse/web --workspace @gatehouse/shared --include-workspace-root \
 && VITE_CODEHOUSE_REMOTE=cnw npm run build -w @gatehouse/web

FROM node:22-alpine
ENV NODE_ENV=production CNW_DATA=/data PORT=8080
WORKDIR /app
# git and the Docker command line are for the updater service, which runs from the same image. /caddy-config is where
# cnw-config writes caddy's configuration (owned by cnw, so the named volume starts writable for it).
RUN apk add --no-cache git docker-cli docker-cli-compose \
 && addgroup -S cnw && adduser -S cnw -G cnw && mkdir -p /data /caddy-config && chown cnw:cnw /data /caddy-config
COPY --from=build --chown=cnw:cnw /src /app
USER cnw
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/me >/dev/null || exit 1
CMD ["npx", "tsx", "apps/cnw/src/main.ts"]
