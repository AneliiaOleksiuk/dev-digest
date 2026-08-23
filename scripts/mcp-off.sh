#!/usr/bin/env bash
#
# Unregister the local MCP server from Claude Code (undoes ./scripts/mcp-on.sh).

set -euo pipefail

claude mcp remove --scope local devdigest
