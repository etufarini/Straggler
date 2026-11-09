#!/usr/bin/env bash

memory_available() {
    local device=${EFFECTIVE_DEVICE:-$DEVICE}
    platform_memory_snapshot
    declare -gA DEVICE_FREE=()
    GPU_DEVICE_NAMES=()
    if [[ $(platform_memory_style) == margins && "$device" != none ]]; then server_devices || true; fi
}
