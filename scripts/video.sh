#!/usr/bin/env bash
# The side-by-side video: one real-time pass of the camera path per engine,
# captured as Chrome presents it (harness/run.ts --video), each engine alone
# on the GPU, then harness/video.ts puts the two side by side with each
# pass's frame time over it. Measures the existing builds; the numbers in
# the README's table come from run-all.sh's runs, which capture nothing.
#
#   scripts/video.sh results/<name>          writes results/<name>/video/
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
source scripts/env.sh
out=${1:?usage: scripts/video.sh results/<name>}/video
mkdir -p "$out"
for engine in origin three; do
  root=$([ "$engine" = origin ] && echo origin/the-last-light/dist || echo three/dist)
  bun harness/run.ts --engine "$engine" --root "$root" --out "$out/$engine" --warmup
  # A pass the harness finds disturbed (exit 3) is kept and said so: the video shows what it shows.
  bun harness/run.ts --engine "$engine" --root "$root" --out "$out/$engine" --video || { s=$?; [ "$s" = 3 ] || exit "$s"; echo "video: $engine's pass was disturbed (run.json)" >&2; }
done
bun harness/video.ts "$out" --title "${TITLE:-The Last Light, Chrome WebGPU, 2560x1440, Apple M4 Pro: each engine in its own pass, with its frame time}"
