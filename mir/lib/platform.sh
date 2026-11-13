#!/usr/bin/env bash
# Platform contract: load one adapter, preserving configuration in this shell.
fail() { printf '%s\n' "$*" >&2; exit 1; }

load_platform() {
    case "$1" in linux|macos) ;; *) printf 'Invalid platform adapter: %s\n' "$1" >&2; return 1 ;; esac
    if [[ -n "${PLATFORM_LOADED:-}" ]]; then
        [[ "$PLATFORM_LOADED" == "$1" ]] && return 0
        printf 'Cannot mix platform adapters in one launcher process.\n' >&2
        return 1
    fi
    if [[ "$1" == macos ]] && ! declare -F macos_dependency_hint >/dev/null; then
        source "$MIR_ROOT/lib/platform/macos-bootstrap.sh" || return 1
    fi
    source "$MIR_ROOT/lib/platform/$1.sh" || return 1
    PLATFORM_LOADED=$1
}

check_dependencies() {
    local mode=$1 tool
    local -a missing=() tools=()
    platform_required_tools
    tools=("${REQUIRED_TOOLS[@]}")
    if [[ "$mode" == install ]]; then
        tools+=(bash uname tar gzip mktemp chmod mkdir mv ln rm flock ps sort grep dirname sleep cp)
    fi
    for tool in "${tools[@]}"; do
        command -v "$tool" >/dev/null || missing+=("$tool")
    done
    (( ${#missing[@]} > 0 )) || return 0
    if [[ "$mode" == install ]]; then
        printf 'Installation cannot continue. Missing required commands:\n' >&2
        printf '  - %s\n' "${missing[@]}" >&2
    else
        printf 'Required command not found: %s\n' "${missing[@]}" >&2
    fi
    platform_dependency_hint "${missing[@]}" >&2
    if [[ "$mode" == install ]]; then printf 'The existing installation has not been changed.\n' >&2; fi
    return 1
}

# Shared helpers used by desktop preparation.
platform_helper() { python3 "$MIR_ROOT/lib/desktop.py" "$@"; }
platform_lock() {
    case "$1" in
        wait) flock "$2" ;;
        unlock) flock -u "$2" ;;
        *) return 1 ;;
    esac
}
replace_path() { platform_move "$1" "$2" replace; }
