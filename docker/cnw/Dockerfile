# Codehouse Neighbourhood Watch (O41). Built from the repository root:
#   docker build -f docker/cnw/Dockerfile -t codehouse-cnw .
# The image holds CNW's server and the Codehouse interface built for remote use. It runs as an unprivileged user and
# keeps its data in /data (a volume).
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/cnw apps/cnw
COPY apps/web apps/web
RUN npm ci --workspace @gatehouse/cnw --workspace @gatehouse/web --workspace @gatehouse/shared --include-workspace-root \
 && VITE_CODEHOUSE_REMOTE=cnw npm run build -w @gatehouse/web

FROM node:22-alpine
ENV NODE_ENV=production CNW_DATA=/data PORT=8080
WORKDIR /app
# git and the Docker command line are for the updater service, which runs from the same image.
RUN apk add --no-cache git docker-cli docker-cli-compose \
 && addgroup -S cnw && adduser -S cnw -G cnw && mkdir -p /data && chown cnw:cnw /data
COPY --from=build --chown=cnw:cnw /src /app
USER cnw
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/me >/dev/null || exit 1
CMD ["npx", "tsx", "apps/cnw/src/main.ts"]
