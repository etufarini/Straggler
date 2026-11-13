#!/usr/bin/env bash

check_port() {
    local pid
    platform_listeners "$PORT" || fail 'Unable to inspect listening ports.'
    PORT_STATUS="Port $PORT: FREE"
    if [[ -n "$LISTENERS" ]]; then
        PORT_STATUS="Port $PORT: IN USE"
        if (( ${#PIDS[@]} > 0 )); then PORT_STATUS+=$'\n    PID USER     PROCESS'; fi
        for pid in "${PIDS[@]}"; do
            PORT_STATUS+=$'\n'"$(ps -p "$pid" -o pid=,user=,comm= || true)"
        done
        if (( ${#PIDS[@]} == 0 )); then
            PORT_STATUS+=$'\nProcess details unavailable; it cannot be stopped here.'
        fi
    fi
}
