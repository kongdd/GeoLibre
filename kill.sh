#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "$0")"
root=$(pwd -P)
stopped=0

while read -r pid; do
  cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
  [[ "$cwd" == "$root" || "$cwd" == "$root/"* ]] || continue
  pgid=$(ps -o pgid= -p "$pid" | tr -d ' ')
  leader_cwd=$(readlink -f "/proc/$pgid/cwd" 2>/dev/null || true)
  [[ "$leader_cwd" == "$root" || "$leader_cwd" == "$root/"* ]] || continue
  kill -- "-$pgid"
  echo "Stopped GeoLibre process group $pgid."
  stopped=1
done < <(lsof -t -a -iTCP:5173 -sTCP:LISTEN 2>/dev/null || true)

((stopped)) || echo "GeoLibre is not running."
