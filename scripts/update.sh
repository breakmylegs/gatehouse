#!/usr/bin/env bash
# Updates Codehouse Neighbourhood Watch on its server in one command (owner, 18 Nov): from any folder, for the clone
# this script sits in (such as /opt/gatehouse). It notes the commit it runs now, pulls, rebuilds and starts CNW again
# with docker compose (your own proxy's compose file too, when that is how CNW is set up), shows the whole build, and
# waits for CNW's health check. If CNW does not come up healthy, it goes back to the commit it noted, rebuilds that,
# and says so. At the end it prints the old and new commit and CNW's protocol version (the handshake with Codehouse).
#
#   /opt/gatehouse/scripts/update.sh
#
# It stops at the first error. It uses sudo only for docker, and only when your user cannot reach Docker itself.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
stack="$repo/docker/cnw"
say() { printf '\n[update] %s\n' "$*"; }
fail() { printf '\n[update] %s\n' "$*" >&2; exit 1; }

[ -f "$stack/compose.yml" ] || fail "There is no docker/cnw/compose.yml in $repo; run the copy of this script inside your clone."
command -v git >/dev/null || fail "git is not installed."
command -v docker >/dev/null || fail "docker is not installed."

# Docker without sudo when your user may (the docker group); with it only when that is the one way.
docker=(docker)
if ! docker info >/dev/null 2>&1; then
  if command -v sudo >/dev/null && sudo -n docker info >/dev/null 2>&1; then
    docker=(sudo docker)
  elif command -v sudo >/dev/null; then
    say "Your user cannot reach Docker, so docker runs with sudo (it may ask for your password)."
    docker=(sudo docker)
  else
    fail "Your user cannot reach Docker, and there is no sudo. Add yourself to the docker group, then sign in again."
  fi
fi

# The compose files CNW is set up with: the bundled caddy, or your own proxy (COMPOSE_FILE or CNW_MODE in .env).
files=(-f compose.yml)
if [ -f "$stack/.env" ] && grep -Eq '^[[:space:]]*(COMPOSE_FILE=.*own-proxy|CNW_MODE=own-proxy)' "$stack/.env"; then
  files=(-f compose.yml -f compose.own-proxy.yml)
  say "CNW is behind your own proxy: compose.yml with compose.own-proxy.yml."
else
  say "CNW runs with its bundled caddy: compose.yml."
fi
compose() { (cd "$stack" && "${docker[@]}" compose "${files[@]}" "$@"); }

# Nothing of yours is overwritten: a changed tracked file stops the update before anything happens.
if [ -n "$(git -C "$repo" status --porcelain --untracked-files=no)" ]; then
  git -C "$repo" status --short --untracked-files=no
  fail "These files in $repo were changed by hand, so nothing was updated. Undo or commit them, then run this again."
fi

old="$(git -C "$repo" rev-parse HEAD)"
say "Running now: $(git -C "$repo" log -1 --format='%h %s' "$old")"
say "Pulling..."
git -C "$repo" pull --ff-only
new="$(git -C "$repo" rev-parse HEAD)"

# Builds and starts the stack, showing every line of the build.
build() {
  say "Building and starting CNW (the whole build follows)..."
  compose --progress plain up -d --build
}

# CNW's own health check (the image's), for up to four minutes: healthy, or not.
healthy() {
  local id status _
  for _ in $(seq 1 48); do
    id="$(compose ps -q cnw 2>/dev/null || true)"
    if [ -n "$id" ]; then
      status="$("${docker[@]}" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo unknown)"
      case "$status" in
        healthy) return 0 ;;
        unhealthy | exited | dead) say "CNW's health check says: $status."; return 1 ;;
      esac
    fi
    sleep 5
  done
  say "CNW did not report healthy within four minutes."
  return 1
}

build
if healthy; then
  say "CNW is healthy."
else
  say "Showing CNW's last log lines:"
  compose logs --tail 60 cnw || true
  if [ "$old" = "$new" ]; then
    fail "CNW is not healthy, and there was nothing new to go back from. See the log above."
  fi
  say "ROLLING BACK to $(git -C "$repo" log -1 --format='%h' "$old"), the commit that ran before this update."
  git -C "$repo" reset --hard "$old"
  build
  if healthy; then
    say "ROLLED BACK: CNW runs the commit from before the update again, and is healthy. The update did not go in."
  else
    fail "ROLLED BACK, but CNW is still not healthy on the old commit. See docker compose logs cnw in $stack."
  fi
  new="$old"
  rolled=1
fi

# The version and protocol CNW itself reports.
about="$(compose exec -T cnw wget -qO- http://127.0.0.1:8080/api/version 2>/dev/null || true)"
protocol="$(printf '%s' "$about" | sed -n 's/.*"protocol":[[:space:]]*\([0-9][0-9]*\).*/\1/p')"
version="$(printf '%s' "$about" | sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p')"

printf '\n[update] Before:   %s\n' "$(git -C "$repo" log -1 --format='%h %s' "$old")"
printf '[update] Now:      %s\n' "$(git -C "$repo" log -1 --format='%h %s' "$new")"
printf '[update] CNW %s, protocol %s\n' "${version:-?}" "${protocol:-unknown (an older CNW, before the handshake)}"
if [ "${rolled:-0}" = 1 ]; then
  printf '[update] The update was rolled back.\n'
  exit 1
fi
