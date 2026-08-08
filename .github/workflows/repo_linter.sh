#!/usr/bin/env bash
set -euo pipefail

README_FILE="README.md"

if [ ! -f "$README_FILE" ]; then
  echo "error: $README_FILE not found" >&2
  exit 1
fi

# awesome-lint expects a lowercase 'readme.md' in the working directory.
LOWER_README="readme.md"
if [ "$README_FILE" != "$LOWER_README" ] && [ ! -e "$LOWER_README" ]; then
  ln -s "$README_FILE" "$LOWER_README"
  trap 'rm -f "$LOWER_README"' EXIT
fi

npx --yes awesome-lint
