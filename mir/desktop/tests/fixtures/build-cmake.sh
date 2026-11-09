#!/usr/bin/env bash
# Test-only compiler with controlled failure and cancellation points.
printf '%s\n' "$*" >> "$TEST_BUILD_CONTROL/commands"
[[ ! -f "$TEST_BUILD_CONTROL/fail" ]] || exit 1
if [[ "$*" == *'--target help'* ]]; then echo llama-server; exit; fi
if [[ "$*" == *'--target llama-server'* && -f "$TEST_BUILD_CONTROL/pause" ]]; then
    printf '%s\n' "$$" > "$TEST_BUILD_CONTROL/worker"
    trap 'exit 143' TERM
    while true; do sleep .05; done
fi
while (( $# )); do
    if [[ $1 == -B ]]; then
        mkdir -p "$2/bin"
        cp "$TEST_BUILD_SERVER" "$2/bin/llama-server"
        chmod +x "$2/bin/llama-server"
        break
    fi
    shift
done
exit 0
