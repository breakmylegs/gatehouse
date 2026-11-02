# Gatehouse Relay. Builds for linux/amd64 and linux/arm64 (Oracle free tier is ARM). No native addons:
# SQLite is Node's built-in node:sqlite.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --workspace @gatehouse/relay --workspace @gatehouse/phone --include-workspace-root \
 && npm run build -w @gatehouse/phone

FROM node:24-bookworm-slim
ENV NODE_ENV=production RELAY_DATA_DIR=/data RELAY_PHONE_DIST=/app/apps/phone/dist RELAY_PORT=8080 RELAY_HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json /app/tsconfig.base.json ./
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/apps/relay apps/relay
COPY --from=build /app/apps/phone/package.json apps/phone/package.json
COPY --from=build /app/apps/phone/dist apps/phone/dist
RUN npm ci --omit=dev --workspace @gatehouse/relay --workspace @gatehouse/shared \
 && mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8080/api/public/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "apps/relay/src/main.ts"]
