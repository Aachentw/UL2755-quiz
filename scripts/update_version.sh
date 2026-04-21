#!/bin/sh
# Regenerates version.json from current git state.
# Run as a pre-commit hook (see .githooks/pre-commit).

set -e

count=$(git rev-list --count HEAD 2>/dev/null || echo 0)
# Pre-commit hook runs before this commit exists, so bump by 1 so the
# emitted version matches the commit that's about to be created.
next=$((count + 1))
date=$(date +%Y-%m-%d)

cat > version.json <<EOF
{
  "version": "v0.$next",
  "built_at": "$date"
}
EOF

# Stage the generated file so it's part of the commit being made.
git add version.json
