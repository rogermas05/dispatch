#!/bin/sh
set -e

# Railway attaches the volume at runtime, which replaces whatever ownership the
# image set at build time with a root-owned mount. The process runs as `node`,
# so without this it fails on first write with EACCES and the worker crashloops.
# Fix ownership while we are still root, then drop privileges before exec'ing —
# the agent reads untrusted input and untrusted call audio, so it should not be
# running as root.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data/journal /data/results /data/jobs
  chown -R node:node /data
  exec su node -s /bin/sh -c "$*"
fi

exec "$@"
