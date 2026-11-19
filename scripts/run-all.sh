#!/usr/bin/env bash
# Reruns everything: setup, both builds, one measured run per engine, and the
# summary. Close other apps first (the harness records the load and the
# busiest processes before each run in run.json).
#
#   scripts/run-all.sh [results/<name>]     default results/<UTC date and time>
#   SKIP_BUILD=1 scripts/run-all.sh         measure the existing builds
#   ENGINES="three" scripts/run-all.sh ...  rerun one engine into a results dir
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
source scripts/env.sh

out=${1:-results/$(date -u +%Y-%m-%dT%H%MZ)}
if [ -z "${SKIP_BUILD:-}" ]; then
  scripts/setup.sh
  scripts/build.sh
fi
mkdir -p "$out"
for engine in ${ENGINES:-origin three}; do
  case $engine in
    origin) root=origin/night-shift/dist ;;
    three) root=three/dist ;;
    *) echo "run-all: no engine $engine" >&2; exit 1 ;;
  esac
  # A warm-up load first: macOS keeps compiled Metal shaders in a cache
  # outside Chrome's profile, shared by every Chrome, so a page's first load
  # after a build compiles its shaders and later ones do not. Each engine's
  # recorded run is its second load of this build, so both find their
  # shaders there; Chrome's own profile is new for both runs.
  bun harness/run.ts --engine "$engine" --root "$root" --out "$out/$engine" --warmup
  bun harness/run.ts --engine "$engine" --root "$root" --out "$out/$engine"
done
bun harness/report.ts "$out"
