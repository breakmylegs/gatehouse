# Mac fork (owner, 18 Nov): the Mac's Codehouse-Update.exe. Copied by the Host from the new Codehouse.app into its updates
# folder (apps/host/src/update/service-mac.ts) and started by the window app as: /bin/sh codehouse-update.sh <plan> <pid>,
# after which the window app quits. Tested by apps/host/test/codehouse-update-mac.test.ts.
#
# The plan is key=value lines, read as text and never run: mode (apply or rollback), app (the installed Codehouse.app),
# candidate (the app to switch to), previous (where the old app is kept), from, to, health (the started.json the new
# version's Host writes), result, timeout (seconds). candidate and previous must be inside the plan's own folder.
#
# It waits for <pid> to quit, swaps the apps, opens the new one and waits for it to say it started as <to>. If it does
# not within the time allowed, it closes it and puts the old one back. It writes result (key=value) for Settings.
PLAN="$1"
PID="$2"
DIR="$(/usr/bin/dirname "$PLAN")"
LOG="$DIR/update.log"
OPEN="${CODEHOUSE_UPDATE_OPEN:-/usr/bin/open}"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
say() { echo "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ) $1" >> "$LOG"; }

mode=; app=; candidate=; previous=; from=; to=; health=; result=; timeout=240
while IFS= read -r line || [ -n "$line" ]; do
  k="${line%%=*}"; v="${line#*=}"
  case "$k" in
    mode) mode="$v" ;; app) app="$v" ;; candidate) candidate="$v" ;; previous) previous="$v" ;;
    from) from="$v" ;; to) to="$v" ;; health) health="$v" ;; result) result="$v" ;; timeout) timeout="$v" ;;
  esac
done < "$PLAN"

finish() {
  tmp="$result.tmp"
  printf 'ok=%s\nmode=%s\nfrom=%s\nto=%s\nreason=%s\nat=%s\n' "$1" "$mode" "$from" "$to" "$2" \
    "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)" > "$tmp" && /bin/mv -f "$tmp" "$result"
  say "finished: ok=$1 $2"
  [ "$1" = true ] && exit 0 || exit 1
}

inside() { case "$1" in "$DIR"/*) case "$1" in *"/../"*|*"/./"*) return 1 ;; esac; return 0 ;; *) return 1 ;; esac; }
inside "$result" || result="$DIR/result.txt"
case "$mode" in apply|rollback) ;; *) finish false "The plan has no mode." ;; esac
case "$app" in /*.app) ;; *) finish false "The plan's app is not an app." ;; esac
case "$app" in *"/../"*|*"/./"*) finish false "The plan's app is not a plain path." ;; esac
inside "$candidate" && inside "$previous" && inside "$health" \
  || finish false "The plan names a place outside Codehouse's updates folder."
case "$timeout" in ''|*[!0-9]*) timeout=240 ;; esac

say "$mode from $from to $to: waiting for Codehouse to quit"
i=0
while /bin/kill -0 "$PID" 2>/dev/null; do
  i=$((i+1)); [ "$i" -gt 120 ] && finish false "Codehouse did not quit within a minute, so nothing was changed."
  /bin/sleep 0.5
done

program="$app/Contents/MacOS/Codehouse"
stop_new() {
  for p in $(/bin/ps -axo pid=,command= | /usr/bin/awk -v p="$program" 'index($0, p) { print $1 }'); do
    /bin/kill "$p" 2>/dev/null
  done
  /bin/sleep 3
}

# Swap: the old app to previous, the candidate to app. Undone at once if either move fails.
/bin/mkdir -p "$(/usr/bin/dirname "$previous")"
swap="$DIR/mac-swap"
/bin/rm -rf "$swap"; /bin/mkdir -p "$swap"
if ! /bin/mv "$app" "$swap/Codehouse.app"; then
  finish false "macOS did not let Codehouse move itself aside (it may need App Management in System Settings, Privacy & Security). Nothing was changed."
fi
if ! /bin/mv "$candidate" "$app"; then
  /bin/mv "$swap/Codehouse.app" "$app"
  finish false "The new Codehouse.app could not be put in place, so the old one is back."
fi
/bin/rm -rf "$previous"
/bin/mv "$swap/Codehouse.app" "$previous"
/bin/rmdir "$swap" 2>/dev/null
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f "$app" 2>/dev/null

/bin/rm -f "$health"
say "opening $app"
"$OPEN" "$app"
i=0
while [ "$i" -lt "$timeout" ]; do
  if [ -f "$health" ] && /usr/bin/grep -Fq "\"version\":\"$to\"" "$health"; then
    finish true ""
  fi
  /bin/sleep 1; i=$((i+1))
done

# It did not start: close it, put the old one back and open that. The one that would not start is not kept.
say "$to did not start within $timeout seconds; going back"
stop_new
/bin/rm -rf "$swap"; /bin/mkdir -p "$swap"
/bin/mv "$app" "$swap/Codehouse.app" && /bin/mv "$previous" "$app" && /bin/rm -rf "$swap"
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f "$app" 2>/dev/null
"$OPEN" "$app"
finish false "Version $to did not start within $timeout seconds, so Codehouse went back to $from."
