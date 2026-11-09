#!/usr/bin/env bash
# Runs a command with Node 24 from the Flatpak SDK extension, inside the
# plugin folder. There is no Node on this machine outside that sandbox.
#
#   ./nodeenv.sh npm install
#   ./nodeenv.sh npm run build
#   NODEENV_DIR=/some/other/dir ./nodeenv.sh node --version
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${NODEENV_DIR:-$ROOT}"

exec flatpak run \
  --devel \
  --share=network \
  --filesystem="$ROOT" \
  --command=sh \
  org.freedesktop.Sdk//25.08 \
  -c "export PATH=/usr/lib/sdk/node24/bin:\$PATH
      export npm_config_cache='$ROOT/.npm-cache'
      cd '$DIR'
      $*"
