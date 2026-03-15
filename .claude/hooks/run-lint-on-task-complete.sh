#!/bin/sh

set -eu

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

cd "$PROJECT_DIR"

if npm run lint >/tmp/bankan-claude-task-lint.log 2>&1; then
  exit 0
fi

cat /tmp/bankan-claude-task-lint.log >&2
exit 2
