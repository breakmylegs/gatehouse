# Mac fork. Started by scripts/package-mac.mjs --install --when-quit, as sh -c <this> codehouse-install <program>
# <staging> <dest> <lsregister> <log> <pid file>: waits until the Codehouse running <program> quits (for up to a
# day), puts the staged copy in place of <dest> and opens it. Tested by apps/host/test/install-when-quit-mac.test.ts.
LOG="$5"
# A test opens nothing; otherwise the Mac's own open.
OPEN="${CODEHOUSE_INSTALL_OPEN:-/usr/bin/open}"
say() { echo "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ) $1" >> "$LOG"; }
say "waiting for Codehouse to quit"
i=0
while /bin/ps -axo command= | /usr/bin/grep -Fxq "$1"; do
  i=$((i+1)); if [ "$i" -gt 43200 ]; then say "gave up after a day; the new copy is in $2"; exit 1; fi
  /bin/sleep 2
done
/bin/sleep 2
# The old copy is kept until the new one is in place, and put back if it cannot be.
if [ -e "$3" ] && ! /bin/mv "$3" "$3.previous"; then say "could not move the old copy aside; nothing changed"; exit 1; fi
if /bin/mv "$2/Codehouse.app" "$3"; then
  /bin/rm -rf "$3.previous"; /bin/rmdir "$2"
  "$4" -f "$3"; /usr/bin/mdimport "$3"; say "installed $3"; /bin/rm -f "$6"; "$OPEN" "$3"
else
  [ -e "$3.previous" ] && /bin/mv "$3.previous" "$3"
  say "could not put the new copy in place, so the old one is back; the new copy is in $2"; exit 1
fi
