#!/usr/bin/env bash
# Record signals instead of touching real processes.
set -euo pipefail
MIR_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$MIR_ROOT/tests/helpers/core.sh"
load_test_core fake
source "$MIR_ROOT/lib/desktop.sh"
setup_test_workspace
for scenario in term force recycled disappeared permission unidentified; do
    (
        TARGET_PIDS=(123) TARGET_IDENTITIES=(original)
        check_port() { PIDS=(123); if [[ $scenario == unidentified ]]; then PIDS=(); fi; }
        ps() {
            case "$scenario" in
                disappeared) return 1 ;;
                recycled) printf reused ;;
                *) printf original ;;
            esac
        }
        sleep() { :; }
        kill() {
            printf '%s\n' "$*" >> "$work/signals"
            [[ $scenario != permission ]]
        }
        rm -f "$work/signals"
        signal=TERM
        if [[ $scenario == force ]]; then signal=KILL; fi
        result=0
        (desktop_stop_listeners "$signal") > "$work/output" 2>&1 || result=$?
        signals=$(cat "$work/signals" 2>/dev/null || true)
        case "$scenario" in
            term|permission) [[ $signals == '-TERM 123' ]] ;;
            force) [[ $signals == '-KILL 123' ]] ;;
            *) [[ -z $signals ]] ;;
        esac
        if [[ $scenario == permission ]]; then
            (( result != 0 ))
            [[ $(cat "$work/output") == *'Cannot stop PID 123'* ]]
        else (( result == 0 )); fi
    )
done
printf 'PASS: explicit signals, listener identity, disappeared processes and permission failures\n'
