#!/usr/bin/env bash
set -euo pipefail

branch="${GITHUB_BASE_REF:-main}"
git fetch --no-tags --depth=1 origin "$branch"
expected_pair="$(git show FETCH_HEAD:index.html | grep -o 'const pair=[^;]*;' | head -n 1 || true)"
expected_cache="$(git show FETCH_HEAD:sw.js | grep -o 'queuezerotwo-v[0-9]*' | head -n 1 || true)"

if [[ -z "$expected_pair" || "$expected_pair" != *"esc("* || -z "$expected_cache" ]]; then
  echo "Current base source is missing the expected escaped pair renderer or worker cache allocation." >&2
  exit 1
fi

echo "Expected main pair: $expected_pair"
echo "Expected main worker: $expected_cache"

for attempt in $(seq 1 18); do
  html="$(curl -fsS --max-time 20 https://queuezerotwo.vercel.app/)"
  worker="$(curl -fsS --max-time 20 https://queuezerotwo.vercel.app/sw.js)"
  actual_pair="$(printf '%s' "$html" | grep -o 'const pair=[^;]*;' | head -n 1 || true)"
  actual_cache="$(printf '%s' "$worker" | grep -o 'queuezerotwo-v[0-9]*' | head -n 1 || true)"

  echo "Production HTML pair: ${actual_pair:-<missing>}"
  echo "Production service-worker cache: ${actual_cache:-<missing>}"

  if [[ "$actual_pair" == "$expected_pair" && "$actual_pair" == *"esc("* && "$actual_cache" == "$expected_cache" ]]; then
    echo "PASS: Production serves the escaped main pair renderer and the current main cache version."
    exit 0
  fi

  if (( attempt < 18 )); then
    echo "Production alias has not caught up to main yet (attempt $attempt/18); retrying in 10 seconds."
    sleep 10
  fi
done

echo "FAIL: Production alias did not match current main after 18 attempts." >&2
exit 1
