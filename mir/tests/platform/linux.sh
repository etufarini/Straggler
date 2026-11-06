#!/usr/bin/env bash
# Linux adapter contract with isolated commands; works on either host OS.
set -euo pipefail
MIR_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$MIR_ROOT/tests/helpers/core.sh"
load_test_core linux
ss() {
    [[ "$*" == '-H -ltnp sport = :9931' ]] || return 2
    printf '%s' "${TEST_LISTENERS:-}"
    return "${TEST_INSPECTION_EXIT:-0}"
}
PORT=9931
check_port
[[ "$PORT_STATUS" == 'Port 9931: FREE' && ${#PIDS[@]} == 0 ]]
TEST_LISTENERS='LISTEN 0 128 0.0.0.0:9931 0.0.0.0:*'
check_port
[[ "$PORT_STATUS" == *'IN USE'* && ${#PIDS[@]} == 0 ]]
TEST_LISTENERS='LISTEN 0 128 [::]:9931 [::]:* users:(("server",pid=123,fd=4),("server",pid=123,fd=5),("other",pid=456,fd=6))'
check_port
[[ ${PIDS[*]} == '123 456' ]]
# Verify sorted, unique PIDs when some listeners hide process details.
TEST_LISTENERS=$'LISTEN 0 128 [::]:9931 [::]:* users:(("one",pid=20,fd=4),("two",pid=3,fd=5))\nLISTEN 0 128 0.0.0.0:9931 0.0.0.0:* users:(("one",pid=20,fd=6),("three",pid=100,fd=7))\nLISTEN 0 128 127.0.0.1:9931 0.0.0.0:*'
check_port
[[ ${PIDS[*]} == '3 20 100' && $LISTENERS == "$TEST_LISTENERS" ]]
TEST_LISTENERS='LISTEN 0 128 127.0.0.1:9931 0.0.0.0:* users:(("one",pid=20,fd=4))'
platform_listeners 9931
[[ ${PIDS[*]} == 20 ]]
TEST_LISTENERS='LISTEN 0 128 127.0.0.1:9931 0.0.0.0:*'
platform_listeners 9931
[[ ${#PIDS[@]} == 0 ]]
TEST_INSPECTION_EXIT=1
if platform_listeners 9931; then exit 1; fi
xdg-open() { [[ "$1" == 'http://[::1]:9931/path with spaces' ]]; }
platform_open_url 'http://[::1]:9931/path with spaces'
platform_required_tools
[[ ${REQUIRED_TOOLS[*]} == 'curl ss' && $(platform_browser_command) == xdg-open ]]
[[ $(platform_memory_style) == margins ]]
platform_multi_gpu_ui
[[ $(platform_gpu_build_note) == *'drivers'* ]]
move_args=''
mv() { printf -v move_args '%s|' "$@"; }
platform_move '/source with spaces' '/target with spaces' no-clobber
[[ "$move_args" == '-Tn|--|/source with spaces|/target with spaces|' ]]
platform_move /source /target replace
[[ "$move_args" == '-fT|--|/source|/target|' ]]
if platform_move /source /target invalid; then exit 1; fi
hint=$(platform_dependency_hint ss flock ps)
[[ "$hint" == *iproute2* && "$hint" == *util-linux* && "$hint" == *procps* ]]
printf 'PASS: Linux adapter listeners, inspection failures, browser, tools, memory capability and atomic move contract\n'
