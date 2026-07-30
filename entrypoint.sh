#!/bin/sh
set -eu

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

case "$PUID:$PGID" in
  *[!0-9:]*|:) echo "PUID and PGID must be numeric values" >&2; exit 64 ;;
esac

if [ "$(id -u)" = "0" ]; then
  if [ "$(id -g node)" != "$PGID" ]; then groupmod -o -g "$PGID" node; fi
  if [ "$(id -u node)" != "$PUID" ]; then usermod -o -u "$PUID" node; fi
  mkdir -p /app/data
  chown -R node:node /app/data
  exec gosu node "$@"
fi

exec "$@"
