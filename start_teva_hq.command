#!/bin/sh
# Starts the TEVA HQ VirtOffice server and the board sync loop. Close this window to stop both.
cd "$(dirname "$0")"
/bin/sh scripts/teva_sync_loop.sh >> /tmp/teva-virtoffice-sync.log 2>&1 &
SYNC=$!
trap 'kill $SYNC 2>/dev/null' EXIT INT TERM
echo "TEVA HQ: http://localhost:9502/office.html  (close this window to stop)"
exec /usr/bin/python3 server.py
