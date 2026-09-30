#!/bin/sh
set -eu
# Refuse ephemeral operation: Railway must attach the persistent store here.
if [ "${RAILWAY_VOLUME_MOUNT_PATH:-}" != /app/data ]; then
  echo 'Persistent Railway volume required at /app/data.' >&2
  exit 1
fi
mkdir -p /app/data/backups
# Only the data volume needs ownership repair; the bot itself runs as node.
if [ "$(id -u)" = 0 ]; then
  chown -R --no-dereference node:node /app/data
  exec gosu node "$@"
fi
exec "$@"
