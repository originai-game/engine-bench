#!/usr/bin/env bash
# Exports The Last Light's content once, as glTF, KTX2 and raw samples, for
# the page that loads standard files (three/). The encodings follow what
# Origin's cook makes of the same sources (og-cook's TextureOptions defaults
# on the main the bench builds: colour and emissive maps ETC1S at quality
# 128; normal and packed occlusion-roughness-metal maps UASTC level 3 with
# RDO 1 and Zstandard; every map with mips; meshes as shipped, quantized by
# gltfpack, meshopt-coded).
#
#   scripts/export-content.sh            # writes three/public/content/
#
# The terrain's height field (16-bit grey) and control map (RGBA weights) go
# out as raw little-endian samples, 1025 x 1025, for the page to build its
# ground from; the server's brotli codes them as it codes Origin's files.
# The generated plants and the staff (Origin's .ogt models) come as .glb
# from `og` glTF export into origin/the-last-light/export/, when present.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
game="$here/origin/the-last-light"
src="$game/assets"
out="$here/three/public/content"
gt="$here/node_modules/.bin/gltf-transform"
# KTX-Software 4.4.2's `ktx`, unpacked by scripts/setup.sh.
export PATH="$here/.tools/ktx/bin:$PATH"
ktx --version | grep -q "v4.4.2" || { echo "export-content: run scripts/setup.sh first (KTX-Software 4.4.2)" >&2; exit 1; }

rm -rf "$out" && mkdir -p "$out/models" "$out/terrain"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

model() {
  local f=$1 name
  name=$(basename "$f")
  "$gt" etc1s "$f" "$tmp/a-$name" --quality 128 --slots "{baseColorTexture,emissiveTexture}" >/dev/null
  "$gt" uastc "$tmp/a-$name" "$tmp/b-$name" --level 3 --rdo --rdo-lambda 1 --zstd 18 --slots "{normalTexture,metallicRoughnessTexture,occlusionTexture}" >/dev/null
  bun "$here/scripts/meshopt.ts" "$tmp/b-$name" "$out/models/$name"
  echo "export-content: models/$name $(stat -f %z "$out/models/$name") bytes"
}
for f in "$src"/models/*.glb; do model "$f"; done
if [ -d "$game/export" ]; then
  for f in "$game"/export/*.glb; do model "$f"; done
fi

colour() { ktx create --format R8G8B8_SRGB --assign-tf srgb --encode basis-lz --qlevel 128 --clevel 1 --generate-mipmap "$1" "$2"; }
data() { ktx create --format R8G8B8_UNORM --assign-tf linear --encode uastc --uastc-quality 3 --uastc-rdo --uastc-rdo-l 1 --zstd 18 --generate-mipmap "$1" "$2"; }
for t in aerial_grass_rock forest_ground_04; do
  colour "$src/terrain/textures/${t}_diff_1k.jpg" "$out/terrain/${t}_diff_1k.ktx2"
  data "$src/terrain/textures/${t}_nor_gl_1k.jpg" "$out/terrain/${t}_nor_gl_1k.ktx2"
done
colour "$src/terrain/textures/rock_face_03_grey_1k.jpg" "$out/terrain/rock_face_03_grey_1k.ktx2"
data "$src/terrain/textures/rock_face_03_nor_gl_1k.jpg" "$out/terrain/rock_face_03_nor_gl_1k.ktx2"
magick "$src/terrain/coast-height.png" -endian LSB -depth 16 "gray:$out/terrain/coast-height.r16"
magick "$src/terrain/coast-control.png" -depth 8 "rgba:$out/terrain/coast-control.rgba"
du -sh "$out"
