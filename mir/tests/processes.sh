#!/usr/bin/env bash
# Shared shutdown safety: every signal is recorded, never sent to a real process.
set -euo pipefail
MIR_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$MIR_ROOT/tests/helpers/core.sh"
load_test_core fake
setup_test_workspace

for scenario in free unidentified cancel term force recycled-term recycled-kill disappeared permission; do
    (
        PORT=9931
        check_port() {
            LISTENERS=occupied PIDS=(123) PORT_STATUS='Port 9931: IN USE'
            case "$scenario" in
                free) LISTENERS='' PIDS=() ;;
                unidentified) PIDS=() ;;
            esac
        }
        TEST_IDENTITY=original
        ps() { [[ $TEST_IDENTITY != missing ]] && printf '%s\n' "$TEST_IDENTITY"; }
        sleep() { :; }
        message() { printf '%s\n' "$*" >> "$work/messages"; }
        kill() {
            printf '%s\n' "$*" >> "$work/signals"
            [[ $scenario != permission ]]
        }
        ui() {
            printf '%s\n' "$*" >> "$work/prompts"
            case "$scenario:$*" in
                cancel:*) return 1 ;;
                recycled-term:*) TEST_IDENTITY=recycled ;;
                disappeared:*) TEST_IDENTITY=missing ;;
                recycled-kill:*SIGKILL*) TEST_IDENTITY=recycled ;;
                force:*SIGKILL*) return 0 ;;
                *:*SIGKILL*) return 1 ;;
            esac
        }
        command rm -f -- "$work/signals" "$work/prompts" "$work/messages"
        stop_listener
        signals=$(cat "$work/signals" 2>/dev/null || true)
        case "$scenario" in
            force) [[ $signals == $'-TERM 123\n-KILL 123' ]] ;;
            term|recycled-kill|permission) [[ $signals == '-TERM 123' ]] ;;
            *) [[ -z $signals ]] ;;
        esac
        case "$scenario" in
            free|unidentified) [[ ! -e $work/prompts ]] ;;
            permission) [[ $(cat "$work/messages") == *'Cannot stop PID 123'* ]] ;;
            force|recycled-kill) [[ $(cat "$work/prompts") == *SIGKILL* ]] ;;
        esac
        printf 'PASS: listener shutdown %s\n' "$scenario"
    )
done
