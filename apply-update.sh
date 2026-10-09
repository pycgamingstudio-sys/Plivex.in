#!/bin/bash
# Run from your project root (the folder that has package.json and src/)
# Usage: bash apply-update.sh
set -e
for f in *@@*; do
  [ -f "$f" ] || continue
  dest="${f//@@//}"
  mkdir -p "$(dirname "$dest")"
  cp "$f" "$dest"
  echo "updated: $dest"
done
