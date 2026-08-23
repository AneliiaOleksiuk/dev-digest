#!/usr/bin/env bash
#
# Register the local MCP server with Claude Code (local scope — private to
# you, not auto-started for the whole project). Run this only when you need
# the MCP tools; pair with ./scripts/mcp-off.sh when done.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

claude mcp add --scope local devdigest -- npx tsx mcp/src/index.ts
