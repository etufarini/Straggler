#!/usr/bin/env bash
# macOS operations. Definitions only; bootstrap discovery lives separately.
# shellcheck disable=SC2034 # REQUIRED_TOOLS is an output consumed by the loader.
platform_required_tools() { REQUIRED_TOOLS=(curl gmv lsof netstat); }
platform_open_url() { open "$1"; }
platform_move() {
    case "$3" in
        replace) gmv -fT -- "$1" "$2" ;;
        no-clobber)
            # GNU mv can fail when no-clobber preserves a concurrent destination.
            gmv -Tn -- "$1" "$2" || [[ ( -e "$1" || -L "$1" ) && ( -e "$2" || -L "$2" ) ]] ;;
        *) return 2 ;;
    esac
}
platform_timeout() {
    local timer=gtimeout
    if ! command -v "$timer" >/dev/null; then timer=timeout; fi
    command -v "$timer" >/dev/null || return 1
    "$timer" --kill-after=1 "$@" 2>/dev/null
}
platform_dependency_hint() { macos_dependency_hint; }
platform_listeners() {
    local pid line sockets proto address state _
    PIDS=()
    # netstat sees listeners even when lsof cannot disclose their processes.
    sockets=$(netstat -an -p tcp) || return 1
    LISTENERS=''
    while read -r proto _ _ address _ state _; do
        if [[ "$proto" == tcp* && "$state" == LISTEN && "${address##*.}" == "$1" ]]; then
            LISTENERS+="$proto $address $state"$'\n'
        fi
    done <<< "$sockets"
    if [[ -n "$LISTENERS" ]]; then
        # Exit 1 means no visible matches, not necessarily a free port.
        if line=$(lsof -nP -a -iTCP:"$1" -sTCP:LISTEN -Fp 2>/dev/null); then
            while IFS= read -r pid; do
                [[ "$pid" =~ ^p([0-9]+)$ ]] && PIDS+=("${BASH_REMATCH[1]}")
            done < <(printf '%s\n' "$line" | sort -u)
        fi
    fi
}

platform_ensure_dependencies() {
    local group=$1 index tool
    local -a tools=() formulas=() missing=()
    case "$group" in
        launcher) tools=(gmv flock); formulas=(coreutils flock) ;;
        desktop-runtime) tools=(python3); formulas=(python) ;;
        desktop) tools=(python3 gtimeout); formulas=(python coreutils) ;;
        *) printf 'Unknown dependency group: %s\n' "$group" >&2; return 1 ;;
    esac
    if [[ "$group" == desktop ]]; then
        if ! xcode-select -p >/dev/null 2>&1 || ! xcrun --find clang >/dev/null 2>&1 ||
            ! xcrun --find clang++ >/dev/null 2>&1 || ! xcrun --sdk macosx --show-sdk-path >/dev/null 2>&1; then
            printf 'Apple command line tools and a macOS SDK are required. Run xcode-select --install, finish installation, then retry.\n' >&2
            return 1
        fi
        for tool in git make cc c++; do
            command -v "$tool" >/dev/null || { printf 'Required developer tool not found: %s. Check your Apple command line tools installation.\n' "$tool" >&2; return 1; }
        done
    fi
    for index in "${!tools[@]}"; do
        command -v "${tools[index]}" >/dev/null || missing+=("${formulas[index]}")
    done
    if (( ${#missing[@]} > 0 )); then
        if [[ -n ${2:-} ]]; then
            "$2" macos_install_packages "${missing[@]}" || return 1
        else
            macos_install_packages "${missing[@]}" || return 1
        fi
        for tool in "${tools[@]}"; do
            command -v "$tool" >/dev/null || { printf 'Required command still unavailable after installation: %s\n' "$tool" >&2; return 1; }
        done
    fi
    if [[ "$group" == launcher ]]; then check_dependencies install || return 1; fi
    return 0
}

platform_start_worker() {
    # Python supplies setsid on macOS without an extra runtime package.
    exec python3 -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' "$@"
}

platform_node_system() { printf darwin; }
