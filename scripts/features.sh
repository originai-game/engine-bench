#!/usr/bin/env bash
# The feature section (README, "What each engine draws"): for each feature
# Origin draws and three.js does not (or draws by hand), one held frame of
# Origin with it and one without, at a path time where it shows, and
# three.js's frame at that time. Two rounds, interleaved, so a drift on the
# machine shows as rounds that disagree. Measures the existing builds.
#
#   scripts/features.sh results/<name>        writes results/<name>/features/
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
source scripts/env.sh
out=${1:?usage: scripts/features.sh results/<name>}/features
mkdir -p "$out"

# time:feature[,feature...]  (the base runs have no feature)
RUNS=(
  "0.5:" "0.5:taa" "0.5:grass" "0.5:scatter" "0.5:wind"
  "8:" "8:clouds" "8:sky"
  "12:" "12:exposure" "12:sea" "12:seafx"
  "16:" "16:cloth" "16:rope"
)
TIMES=(0.5 8 12 16)

held() { # engine time off dir
  local status=0
  for attempt in 1 2 3; do
    status=0
    bun harness/run.ts --engine "$1" --root "$([ "$1" = origin ] && echo origin/the-last-light/dist || echo three/dist)" \
      --hold "$2" ${3:+--off "$3"} --out "$4" || status=$?
    [ "$status" = 3 ] || break
  done
  [ "$status" = 0 ] || { echo "features: $1 at $2 off '$3' failed ($status)" >&2; exit 1; }
}

bun harness/run.ts --engine origin --root origin/the-last-light/dist --out "$out/warmup" --warmup
bun harness/run.ts --engine three --root three/dist --out "$out/warmup" --warmup
for round in 1 2; do
  for run in "${RUNS[@]}"; do
    t=${run%%:*} f=${run#*:}
    held origin "$t" "$f" "$out/r$round/origin-$t-${f:-base}"
  done
  for t in "${TIMES[@]}"; do held three "$t" "" "$out/r$round/three-$t"; done
done
bun harness/features-report.ts "$out"
