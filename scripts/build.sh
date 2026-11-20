#!/usr/bin/env bash
# Builds both pages as a player gets them:
#   origin/the-last-light/dist  og build --publish: the released engine through
#                               the launcher, or OG_ENGINE_PACKAGE's (scripts/env.sh)
#   three/dist                  the glTF/KTX2 export and a production vite build
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
source scripts/env.sh

(cd origin/the-last-light && og_engine build . --publish)
scripts/export-content.sh
rm -rf three/public/basis && mkdir -p three/public/basis
cp node_modules/three/examples/jsm/libs/basis/basis_transcoder.{js,wasm} three/public/basis/
bunx vite build --config three/vite.config.ts
