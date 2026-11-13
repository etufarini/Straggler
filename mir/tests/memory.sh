#!/usr/bin/env bash
# Missing memory is optional data and never disables server controls.
set -euo pipefail
MIR_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$MIR_ROOT/tests/helpers/core.sh"
load_test_core fake
setup_test_workspace
initialize_config ""
server_devices() {
    GPU_DEVICE_NAMES=(First Second)
    DEVICE_FREE=([First]=4096 [Second]=2048)
}
memory_available
[[ $RAM_AVAILABLE == 16384 && ${DEVICE_FREE[First]} == 4096 ]]
DEVICE=none
memory_available
[[ $RAM_AVAILABLE == 16384 && ${#DEVICE_FREE[@]} == 0 ]]
unset EFFECTIVE_DEVICE
DEVICE=auto
platform_memory_snapshot() { RAM_AVAILABLE=''; }
server_devices() { return 1; }
memory_available
[[ -z $RAM_AVAILABLE && ${#DEVICE_FREE[@]} == 0 ]]
printf 'PASS: optional memory data, CPU-only selection and unavailable discovery\n'
