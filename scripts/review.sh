#!/usr/bin/env bash
#
# Run the pre-push review CLI against the local working tree
# (`devdigest review --mode working` by default) — no API server and no
# database required. Extra args (e.g. `--json`, `--agent-file <path.json>`)
# are forwarded as-is. See mcp/README.md's CLI section for the full usage /
# exit-code contract.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/mcp"

if [ "$#" -eq 0 ]; then
  exec npx tsx src/cli.ts review --mode working
else
  exec npx tsx src/cli.ts "$@"
fi
