#!/bin/sh
set -e

# ponytail: Railway (and other volume-mount hosts) create fresh volumes
# owned by root. The image's app user (open-design, uid 1001) can't write
# to a root-owned mount, so as root we chown just the mounted data dir
# then drop to open-design before exec'ing the real command.
if [ "$(id -u)" = "0" ]; then
  chown -R open-design:open-design /app/.od
  exec su-exec open-design:open-design "$@"
fi

exec "$@"
