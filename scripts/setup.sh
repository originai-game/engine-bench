#!/usr/bin/env bash
# Installs what the benchmark builds with, all under .tools/ (nothing global):
# the og launcher and the released engine it runs, KTX-Software 4.4.2 for the
# KTX2 export, the JavaScript dependencies (bun.lock), and Night Shift's
# pinned binary assets.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
source scripts/env.sh

# The og launcher (https://origingame.ai/downloads/engine/install.sh) and the engine project.ogt pins.
if [ ! -x "$ORIGIN_HOME/bin/og" ]; then
  curl -fsSL https://origingame.ai/downloads/engine/install.sh | sh
fi
og engine install "$OG_ENGINE" >/dev/null

# KTX-Software 4.4.2 (gltf-transform 4.5 drives its `ktx` tool), unpacked from Khronos's macOS package.
if ! ktx --version 2>/dev/null | grep -q "v4.4.2"; then
  tmp=$(mktemp -d)
  curl -fsSLo "$tmp/ktx.pkg" https://github.com/KhronosGroup/KTX-Software/releases/download/v4.4.2/KTX-Software-4.4.2-Darwin-arm64.pkg
  pkgutil --expand-full "$tmp/ktx.pkg" "$tmp/x"
  mkdir -p .tools/ktx/bin .tools/ktx/lib
  cp "$tmp"/x/*tools.pkg/Payload/usr/local/bin/* .tools/ktx/bin/
  cp -a "$tmp"/x/*library.pkg/Payload/usr/local/lib/libktx* .tools/ktx/lib/
  for b in .tools/ktx/bin/*; do install_name_tool -add_rpath @executable_path/../lib "$b" 2>/dev/null || true; codesign -s - -f "$b" 2>/dev/null; done
  rm -rf "$tmp"
fi

bun install --frozen-lockfile
bun scripts/fetch-assets.ts
