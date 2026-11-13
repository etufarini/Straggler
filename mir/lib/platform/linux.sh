#!/usr/bin/env bash
# Linux operations. Definitions only; no probing or configuration on import.
# shellcheck disable=SC2034 # REQUIRED_TOOLS is an output consumed by the loader.
platform_required_tools() { REQUIRED_TOOLS=(curl ss); }
platform_open_url() { xdg-open "$1"; }
platform_move() {
    case "$3" in
        replace) mv -fT -- "$1" "$2" ;;
        no-clobber)
            # GNU mv can fail when no-clobber preserves a concurrent destination.
            mv -Tn -- "$1" "$2" || [[ ( -e "$1" || -L "$1" ) && ( -e "$2" || -L "$2" ) ]] ;;
        *) return 2 ;;
    esac
}
platform_timeout() {
    command -v timeout >/dev/null || return 1
    timeout --kill-after=1 "$@" 2>/dev/null
}
platform_listeners() {
    local remaining
    LISTENERS=$(ss -H -ltnp "sport = :$1") || return 1
    PIDS=()
    remaining=$LISTENERS
    while [[ "$remaining" =~ pid=([0-9]+) ]]; do
        PIDS+=("${BASH_REMATCH[1]}")
        remaining=${remaining#*"pid=${BASH_REMATCH[1]}"}
    done
    if (( ${#PIDS[@]} > 1 )); then
        mapfile -t PIDS < <(printf '%s\n' "${PIDS[@]}" | sort -un)
    fi
}
platform_dependency_hint() {
    local tool package
    local -A hint_packages=()
    for tool in "$@"; do
        case "$tool" in
            bash|curl|tar|gzip|grep) package="$tool" ;;
            flock) package=util-linux ;;
            ss) package=iproute2 ;;
            ps) package=procps ;;
            *) package=coreutils ;;
        esac
        hint_packages[$package]=1
    done
    printf 'On Ubuntu/Debian, install the missing packages and retry:\n  sudo apt install'
    printf ' %s' "${!hint_packages[@]}"
    printf '\n'
}

debian_package_manager() {
    local key value distribution='' related=''
    if [[ -r /etc/os-release ]]; then
        while IFS='=' read -r key value; do
            value=${value#\"}; value=${value%\"}
            case "$key" in ID) distribution=$value ;; ID_LIKE) related=$value ;; esac
        done < /etc/os-release
    fi
    [[ " $distribution $related " == *' debian '* || " $distribution $related " == *' ubuntu '* ]] &&
        command -v apt-get >/dev/null && command -v dpkg-query >/dev/null
}

platform_ensure_dependencies() {
    local group=$1 tool package
    local -a tools packages missing=()
    case "$group" in
        launcher)
            tools=(bash curl tar gzip mktemp chmod mkdir mv ln rm flock ss ps sort grep dirname sleep cp)
            packages=(bash curl tar gzip coreutils coreutils coreutils coreutils coreutils coreutils util-linux iproute2 procps coreutils grep coreutils coreutils coreutils) ;;
        desktop-runtime) tools=(python3); packages=(python3) ;;
        desktop)
            tools=(python3 cc c++ make pkg-config setsid)
            packages=(python3 build-essential build-essential build-essential pkg-config util-linux) ;;
        *) printf 'Unknown dependency group: %s\n' "$group" >&2; return 1 ;;
    esac
    for tool in "${!tools[@]}"; do
        if ! command -v "${tools[tool]}" >/dev/null && [[ " ${missing[*]} " != *" ${packages[tool]} "* ]]; then
            missing+=("${packages[tool]}")
        fi
    done
    if debian_package_manager; then
        # Headers and certificates cannot be checked by looking for commands.
        case "$group" in
            launcher) packages=(ca-certificates) ;;
            # WebKitGTK depends on the distribution's GTK runtime (including t64 variants).
            desktop-runtime) packages=(libwebkit2gtk-4.1-0) ;;
            desktop) packages=(libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev) ;;
            *) packages=() ;;
        esac
        for package in "${packages[@]}"; do
            [[ $(dpkg-query -W -f='${Status}' "$package" 2>/dev/null) == 'install ok installed' ]] || missing+=("$package")
        done
    elif (( ${#missing[@]} )); then
        printf 'Missing tools for %s: %s\nAutomatic dependency installation supports Ubuntu/Debian. Install the equivalent packages for your distribution and retry.\n' "$group" "${tools[*]}" >&2
        return 1
    fi
    (( ${#missing[@]} )) || return 0
    if [[ -n ${2:-} ]]; then
        "$2" install_dependency_packages "$group" "${missing[@]}"
    else
        install_dependency_packages "$group" "${missing[@]}"
    fi
}

install_dependency_packages() {
    local answer
    shift
    local -a missing=("$@") command_prefix=()
    printf 'Missing dependency packages: %s\n' "${missing[*]}" >&2
    if [[ ! -r /dev/tty || ! -w /dev/tty ]] || ! { printf 'Install these packages with apt-get? [y/N] ' > /dev/tty; } 2>/dev/null; then
        printf 'A terminal is required to approve installation. Run: sudo apt-get install %s\n' "${missing[*]}" >&2
        return 1
    fi
    IFS= read -r answer < /dev/tty || return 1
    case "$answer" in y|Y|yes|YES) ;; *) printf 'Dependency installation canceled.\n' >&2; return 1 ;; esac
    if (( EUID != 0 )); then
        command -v sudo >/dev/null || { printf 'sudo is unavailable. Ask your administrator to install: %s\n' "${missing[*]}" >&2; return 1; }
        command_prefix=(sudo)
    fi
    "${command_prefix[@]}" apt-get update < /dev/tty || return 1
    "${command_prefix[@]}" apt-get install --no-remove -y "${missing[@]}" < /dev/tty || {
        printf 'Dependency installation failed. Check your package repositories and retry. GPU drivers are configured separately.\n' >&2
        return 1
    }
}

platform_start_worker() { exec setsid "$@"; }

platform_node_system() { printf linux; }
