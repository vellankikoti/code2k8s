#!/usr/bin/env bash
# Validate that every repo in the catalog has a Dockerfile on its default branch.
# Prints OK/MISS per entry. Exit code is 0 if all pass, 1 otherwise.
set -euo pipefail

CATALOG=${CATALOG:-frontend/lib/catalog.json}
FAIL=0
while IFS= read -r entry; do
  repo=$(echo "$entry" | jq -r '.repoUrl' | sed 's#https://github.com/##; s#.git$##')
  branch=$(echo "$entry" | jq -r '.branch')
  url="https://raw.githubusercontent.com/${repo}/${branch}/Dockerfile"
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  if [ "$code" = "200" ]; then
    echo "OK   $repo@$branch"
  else
    echo "MISS $repo@$branch  (HTTP $code)"
    FAIL=1
  fi
done < <(jq -c '.[]' "$CATALOG")
exit $FAIL
