# Sourced by the scripts: the tools under .tools/ and the versions they pin.
here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
export ORIGIN_HOME="$here/.tools/origin"
export ORIGIN_ENGINE_CACHE="$here/.tools/engine-cache"
export PATH="$ORIGIN_HOME/bin:$here/.tools/ktx/bin:$PATH"
# The released engine the launcher installs (origin/the-last-light/project.ogt
# pins the same). OG_ENGINE_PACKAGE, when set, names an engine package built
# from source instead (an origin-engine checkout's packages/engine, built by
# scripts/release-wasm.sh and packages/engine/scripts/build.sh); its own `og`
# builds the page.
export OG_ENGINE="0.9.0"
og_engine() {
  if [ -n "${OG_ENGINE_PACKAGE:-}" ]; then
    "$OG_ENGINE_PACKAGE/native/og.$(uname -s | tr A-Z a-z)-$(uname -m | sed s/x86_64/x64/)" "$@"
  else
    og "$@"
  fi
}
