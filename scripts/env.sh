# Sourced by the scripts: the tools under .tools/ and the versions they pin.
here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
export ORIGIN_HOME="$here/.tools/origin"
export ORIGIN_ENGINE_CACHE="$here/.tools/engine-cache"
export PATH="$ORIGIN_HOME/bin:$here/.tools/ktx/bin:$PATH"
# The released engine (origin/night-shift/project.ogt pins the same).
export OG_ENGINE="0.9.0"
