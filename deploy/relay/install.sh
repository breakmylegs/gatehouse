#!/usr/bin/env bash
# Installs or updates the JCVC phone Relay on a Linux server, in a container (Podman or Docker).
# Run it from the repository folder on the server:
#
#   ./deploy/relay/install.sh https://relay.example.com
#
# The Relay listens on 127.0.0.1:8087 only. Put a web server with https in front of it (see Caddyfile.simple).
# Your laptop and your phone both connect OUT to this address, so nothing has to reach your laptop.
# Running it again updates the Relay and keeps its data (paired phones, the enrolment state) in the volume.
set -euo pipefail

public_url="${1:-}"
if [[ -z "$public_url" || "$public_url" != https://* ]]; then
  echo "Give the https address your phone will use, for example: ./deploy/relay/install.sh https://relay.example.com" >&2
  exit 2
fi

if command -v podman >/dev/null 2>&1; then
  engine=podman
elif command -v docker >/dev/null 2>&1; then
  engine=docker
else
  echo "Neither podman nor docker is installed. Install one, then run this again." >&2
  exit 1
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
name=jcvc-relay
echo "[relay] building the image with $engine (a few minutes the first time)"
"$engine" build -t "$name" -f "$root/deploy/relay/Dockerfile" "$root"

if "$engine" container exists "$name" >/dev/null 2>&1 || "$engine" ps -a --format '{{.Names}}' | grep -qx "$name"; then
  echo "[relay] replacing the running container (the data volume is kept)"
  "$engine" rm -f "$name" >/dev/null
fi

"$engine" run -d --name "$name" --restart unless-stopped \
  -p 127.0.0.1:8087:8080 \
  -v jcvc-relay-data:/data \
  -e RELAY_PUBLIC_URL="$public_url" \
  "$name" >/dev/null

echo "[relay] waiting for it to answer"
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8087/api/public/config >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "${ready:-0}" != 1 ]]; then
  echo "[relay] it did not answer within 2 minutes. Its log:" >&2
  "$engine" logs --tail 40 "$name" >&2
  exit 1
fi

echo
echo "[relay] running on 127.0.0.1:8087 for $public_url"
token="$("$engine" exec "$name" cat /data/enrol-token.txt 2>/dev/null || true)"
if [[ -n "$token" ]]; then
  echo "[relay] one-time enrolment token for JCVC (Devices, Or connect to a Relay you run elsewhere):"
  echo
  echo "    $token"
  echo
else
  echo "[relay] no unused enrolment token: JCVC is already linked. To link again, see the Devices help."
fi
echo "[relay] next: point https://${public_url#https://} at 127.0.0.1:8087 (see deploy/relay/Caddyfile.simple)."
