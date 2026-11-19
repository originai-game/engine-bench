#!/usr/bin/env bash
# Exports Night Shift's models and textures once, as glTF and KTX2, for the
# pages that load standard files (three/). The encodings follow what Origin's
# cook makes of the same sources (og-cook 0.9.0's `.cook.ogt`: texture
# "etc1s 128 uastc 1 rdo 1 zstd true mips true"; meshes quantized and
# meshopt-coded): colour and emissive maps ETC1S at quality 128, normal and
# packed occlusion-roughness-metal maps UASTC level 1 with RDO and Zstandard,
# every map with mips; the meshes keep the shipped files' quantized,
# meshopt-coded geometry.
#
#   scripts/export-content.sh            # writes three/public/content/
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
src="$here/origin/night-shift/assets"
out="$here/three/public/content"
gt="$here/node_modules/.bin/gltf-transform"
# KTX-Software 4.4.2's `ktx`, unpacked by scripts/setup.sh.
export PATH="$here/.tools/ktx/bin:$PATH"
ktx --version | grep -q "v4.4.2" || { echo "export-content: run scripts/setup.sh first (KTX-Software 4.4.2)" >&2; exit 1; }

rm -rf "$out" && mkdir -p "$out/models" "$out/textures/signs"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

for f in "$src"/models/*.glb; do
  name=$(basename "$f")
  "$gt" etc1s "$f" "$tmp/a-$name" --quality 128 --slots "{baseColorTexture,emissiveTexture}" >/dev/null
  "$gt" uastc "$tmp/a-$name" "$tmp/b-$name" --level 1 --rdo --zstd 18 --slots "{normalTexture,metallicRoughnessTexture,occlusionTexture}" >/dev/null
  # The geometry as shipped (gltfpack quantized it), meshopt-coded again.
  bun "$here/scripts/meshopt.ts" "$tmp/b-$name" "$out/models/$name"
  echo "export-content: models/$name $(stat -f %z "$out/models/$name") bytes"
done

colour() { ktx create --format R8G8B8_SRGB --assign-tf srgb --encode basis-lz --qlevel 128 --clevel 1 --generate-mipmap "$1" "$2"; }
data() { ktx create --format R8G8B8_UNORM --assign-tf linear --encode uastc --uastc-quality 1 --uastc-rdo --zstd 18 --generate-mipmap "$1" "$2"; }
for t in cobblestone_01 brushed_concrete; do
  colour "$src/textures/${t}_diff_1k.jpg" "$out/textures/${t}_diff_1k.ktx2"
  data "$src/textures/${t}_nor_gl_1k.jpg" "$out/textures/${t}_nor_gl_1k.ktx2"
  data "$src/textures/${t}_arm_1k.jpg" "$out/textures/${t}_arm_1k.ktx2"
done
colour "$src/textures/tower-windows.jpg" "$out/textures/tower-windows.ktx2"
for s in "$src"/textures/signs/*.png; do colour "$s" "$out/textures/signs/$(basename "${s%.png}").ktx2"; done
du -sh "$out"
