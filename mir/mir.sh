#!/usr/bin/env bash
set -euo pipefail
MIR_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$MIR_ROOT/lib/runtime.sh"
configure_runtime check
if [[ "$RUNTIME_BASH" != "$BASH" ]]; then exec "$RUNTIME_BASH" "${BASH_SOURCE[0]}" "$@"; fi

source "$MIR_ROOT/lib/platform.sh"
load_platform "$PLATFORM_ID"

if [[ ${1:-} == --desktop ]]; then
    fail 'The private shell bridge has been removed. Run mir to open the desktop.'
fi
if (( $# == 0 )) || [[ ${1:-} == --prepare-desktop ]]; then
    source "$MIR_ROOT/lib/bootstrap.sh"
    prepare_desktop || fail 'Desktop preparation failed. Existing builds and user data were kept.'
    if (( $# > 0 )); then exit 0; fi
    exec env MIR_ROOT="$MIR_ROOT" "$GUI_BINARY"
fi
[[ ${1:-} != --tui ]] || fail 'The terminal interface has been removed. Run mir to open the desktop.'
source "$MIR_ROOT/lib/config.sh"
source "$MIR_ROOT/lib/paths.sh"
source "$MIR_ROOT/lib/processes.sh"
source "$MIR_ROOT/lib/server.sh"
initialize_config "$@"
shift
validate_config
prepare_server "$@" || fail "$LAUNCH_ERROR"
run_server
