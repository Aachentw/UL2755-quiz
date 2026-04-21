#!/bin/sh
# Regenerates version.json from current git state.
# Run as a pre-commit hook (see .githooks/pre-commit).

set -e

count=$(git rev-list --count HEAD 2>/dev/null || echo 0)
hash=$(git rev-parse --short=7 HEAD 2>/dev/null || echo "dev")
date=$(date +%Y-%m-%d)

cat > version.json <<EOF
{
  "version": "v0.$count.$hash",
  "commit": "$hash",
  "built_at": "$date"
}
EOF

# Stage the generated file so it's part of the commit being made.
git add version.json
