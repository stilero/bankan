#!/bin/sh

set -eu

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
PAYLOAD="$(cat)"

if [ -z "$PAYLOAD" ]; then
  exit 0
fi

FILE_PATH="$(printf '%s' "$PAYLOAD" | node -e "
let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  const payload = JSON.parse(input || '{}');
  const filePath = payload.tool_input?.file_path || '';
  process.stdout.write(filePath);
});
")"

case "$FILE_PATH" in
  *.js|*.jsx) ;;
  *) exit 0 ;;
esac

case "$FILE_PATH" in
  "$PROJECT_DIR"/*) ;;
  *) exit 0 ;;
esac

(
  cd "$PROJECT_DIR"
  npm exec eslint -- --no-warn-ignored "$FILE_PATH"
) >/tmp/bankan-claude-lint-hook.log 2>&1 &
