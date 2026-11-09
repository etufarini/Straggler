#!/usr/bin/env bash
# Private, data-only desktop operations. The public entry point is mir.sh.

desktop_request() {
    local line key value
    DESKTOP_REQUEST_FILE=$(mktemp -t mir-request.XXXXXXXX)
    trap 'rm -f -- "$DESKTOP_REQUEST_FILE"' EXIT
    python3 "$MIR_ROOT/lib/desktop.py" decode > "$DESKTOP_REQUEST_FILE" || fail 'Invalid desktop request.'
    TARGET_PIDS=(); TARGET_IDENTITIES=()
    while IFS= read -r line; do
        key=${line%%=*}; value=${line#*=}
        case "$key" in
            context) CTX_SIZE=$value ;;
            model|port|device|threads|gpu_layers|prompt_processing|cache_type_k|cache_type_v|split_mode|tensor_split|fit_target)
                printf -v "${key^^}" '%s' "$value" ;;
            @llamaDir) LLAMA_CPP_PATH=$value ;;
            @modelsDir) MODELS_DIR=$value ;;
            @target) TARGET_PIDS+=("${value%%$'\t'*}"); TARGET_IDENTITIES+=("${value#*$'\t'}") ;;
            *) GENERATION[$key]=$value ;;
        esac
    done < "$DESKTOP_REQUEST_FILE"
    SERVER=$(server_path "$LLAMA_CPP_PATH")
    validate_config
}

desktop_snapshot() {
    local previous=$MODEL available=false key pid identity details tag='' backend='' commit='' previous_build='' file
    local multiple=false capabilities
    local -a backends devices=() targets=() free=() profiles=()
    mapfile -t backends < <(platform_build_backends)
    scan_models
    if [[ -n "$previous" ]]; then MODEL=$previous; fi
    [[ ! -f "$SERVER" || ! -x "$SERVER" ]] || available=true
    check_port
    memory_available
    # Discovery is independent from whether an explicit CPU-only setting is active.
    server_devices || true
    server_capabilities
    if multiple_devices_available; then multiple=true; fi
    capabilities=$(python3 "$MIR_ROOT/lib/desktop.py" capabilities \
        "$(cache_types K)" "$(cache_types V)" "$(split_modes)" "$multiple" "$(platform_gpu_build_note)")
    for key in "${!DEVICE_NAMES[@]}"; do
        devices+=("${DEVICE_NAMES[key]}" "${DEVICE_DESCRIPTIONS[key]}")
    done
    for pid in "${PIDS[@]}"; do
        identity=$(ps -p "$pid" -o lstart= 2>/dev/null) || continue
        details=$(ps -p "$pid" -o pid=,user=,comm= 2>/dev/null) || continue
        targets+=("$pid" "$identity" "$details")
    done
    for key in "${GPU_DEVICE_NAMES[@]}"; do free+=("$key" "${DEVICE_FREE[$key]}"); done
    if read_build "$LLAMA_CPP_PATH"; then
        tag=$BUILD_TAG; backend=$BUILD_BACKEND; commit=$BUILD_COMMIT; previous_build=$BUILD_PREVIOUS
    fi
    if [[ -d "$PROFILES_DIR" ]]; then
        while IFS= read -r -d '' file; do
            file=${file##*/}; file=${file%.conf}
            if valid_profile_name "$file"; then profiles+=("$file"); fi
        done < <(platform_files profiles "$PROFILES_DIR")
    fi
    python3 "$MIR_ROOT/lib/desktop.py" snapshot "$LLAMA_CPP_PATH" "$MODELS_DIR" "$available" "$PORT_STATUS" "$PATHS_WARNING" \
        "$(generation_preset)" "$(profile_data)" "${#MODELS[@]}" "${MODELS[@]}" \
        "$((${#devices[@]} / 2))" "${devices[@]}" "$((${#targets[@]} / 3))" "${targets[@]}" \
        "$RAM_AVAILABLE" "$((${#free[@]} / 2))" "${free[@]}" \
        "$((${#backends[@]} / 2))" "${backends[@]}" "$tag" "$backend" "$commit" "$previous_build" \
        "$(generation_preset_values default)" "$(generation_preset_values focused)" \
        "$(generation_preset_values exploratory)" "$(generation_preset_values min-p)" "$capabilities" "${profiles[@]}"
}

desktop_packages() {
    local operation=$1 package
    shift
    if [[ "$operation" == install_dependency_packages ]]; then shift; fi
    [[ "$operation" == install_dependency_packages || "$operation" == macos_install_packages ]] || return 1
    for package in "$@"; do
        if [[ " ${MISSING_PACKAGES[*]} " != *" $package "* ]]; then MISSING_PACKAGES+=("$package"); fi
    done
}

desktop_dependencies() {
    local backend=$1
    platform_build_flags "$backend" || fail 'Choose a build supported on this platform.'
    MISSING_PACKAGES=()
    platform_ensure_dependencies build desktop_packages || return 1
    platform_ensure_dependencies "$backend" desktop_packages || return 1
}

desktop_build() (
    local tag=$1 backend=$2 jobs=$3 root stage previous='' result=0
    valid_build_tag "$tag" && [[ "$jobs" =~ ^([1-9]|[1-5][0-9]|6[0-4])$ ]] || fail 'Invalid release tag or compiler job count.'
    desktop_dependencies "$backend" || fail 'Required build dependencies are unavailable.'
    if (( ${#MISSING_PACKAGES[@]} )); then
        printf 'Requesting permission to install build dependencies...\n'
        platform_authorize_build_packages "$backend" "${MISSING_PACKAGES[@]}" || fail 'Dependency installation was canceled or failed.'
    fi
    root=$(build_root)
    mkdir -p -- "$root/builds"
    exec 9> "$root/.build.lock"
    platform_lock try 9 || fail 'Another llama.cpp build is running.'
    if read_build "$LLAMA_CPP_PATH"; then previous=${LLAMA_CPP_PATH##*/}; fi
    stage=$(mktemp -d "$root/builds/build.XXXXXXXX")
    trap 'result=$?; if (( result != 0 )); then rm -rf -- "$stage"; fi' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM HUP
    build_release "$stage" "$tag" "$backend" "$jobs" "$previous" 2>&1 | tee "$root/build.log" || exit 1
    activate_build "$stage" || fail 'Cannot activate this build. The previous installation was kept.'
    python3 - "$LLAMA_CPP_PATH" <<'PY'
import json, sys
print(json.dumps(dict(mirBuild=1, llamaDir=sys.argv[1])))
PY
)

desktop_stop_listeners() {
    local signal=$1 index pid identity failures='' remaining=false attempt
    [[ "$signal" == TERM || "$signal" == KILL ]] || fail 'Invalid process signal.'
    (( ${#TARGET_PIDS[@]} )) || fail 'No identified listeners were selected.'
    check_port
    for index in "${!TARGET_PIDS[@]}"; do
        pid=${TARGET_PIDS[index]}; identity=${TARGET_IDENTITIES[index]}
        [[ " ${PIDS[*]} " == *" $pid "* ]] || continue
        if [[ $(ps -p "$pid" -o lstart= 2>/dev/null || true) == "$identity" ]]; then
            kill "-$signal" "$pid" 2>/dev/null || failures+="Cannot stop PID $pid. Check process ownership and permissions. "
        fi
    done
    for attempt in {1..20}; do
        remaining=false
        for index in "${!TARGET_PIDS[@]}"; do
            if [[ $(ps -p "${TARGET_PIDS[index]}" -o lstart= 2>/dev/null || true) == "${TARGET_IDENTITIES[index]}" ]]; then remaining=true; fi
        done
        "$remaining" || break
        sleep .1
    done
    [[ -z "$failures" ]] || fail "$failures"
}

desktop_command() {
    local action=${1:-} kind name path previous backend package
    shift || true
    command -v python3 >/dev/null || fail 'Mir.cpp desktop requires Python 3.'
    if [[ "$action" == install-dependencies ]]; then
        (( EUID == 0 && $# >= 2 )) || fail 'Dependency installation needs administrator authorization.'
        backend=$1; shift
        for package in "$@"; do platform_desktop_package_allowed "$backend" "$package" || fail 'This package is outside the selected build dependencies.'; done
        platform_install_desktop_packages "$@" || exit 1
        return 0
    fi
    initialize_config
    desktop_request
    case "$action" in
        inspect) (( $# == 0 )) || fail 'Invalid inspect arguments.' ;;
        browse) python3 "$MIR_ROOT/lib/desktop.py" browse "${1:-$HOME}" "${2:-false}"; return ;;
        start)
            (( $# == 1 )) || fail 'Select a GGUF model.'
            MODEL=$1
            prepare_server --host 127.0.0.1 || fail "$LAUNCH_ERROR"
            python3 - "$URL" <<'PY'
import json, sys
print(json.dumps(dict(mirDesktop=1, url=sys.argv[1])), flush=True)
PY
            rm -f -- "$DESKTOP_REQUEST_FILE"
            trap - EXIT
            exec "$SERVER" "${ARGS[@]}" ;;
        set-path)
            (( $# == 2 )) || fail 'Choose a folder.'
            kind=$1; path=$2
            [[ -d "$path" && -r "$path" && -x "$path" && "$path" != *$'\n'* && "$path" != *$'\r'* ]] || fail 'Choose a readable directory without line breaks.'
            path=$(cd -- "$path" && pwd -P)
            case "$kind" in
                llama) [[ -x "$(server_path "$path")" ]] || fail 'The llama.cpp folder must contain executable build/bin/llama-server or bin/llama-server.'; LLAMA_CPP_PATH=$path ;;
                models) MODELS_DIR=$path; scan_models ;;
                *) fail 'Invalid folder setting.' ;;
            esac
            save_paths || fail 'Cannot save paths. Previous settings were kept.'
            SERVER=$(server_path "$LLAMA_CPP_PATH") ;;
        load-profile|save-profile|delete-profile)
            name=${1:-}; valid_profile_name "$name" || fail 'Invalid configuration name.'
            path="$PROFILES_DIR/$name.conf"
            case "$action" in
                load-profile) load_profile "$path" || fail 'Cannot load configuration: invalid settings or missing model. Current settings were kept.' ;;
                save-profile)
                    [[ -r "$MODEL" && -f "$MODEL" && "${MODEL,,}" == *.gguf ]] || fail 'Select a readable GGUF model before saving.'
                    [[ ! -e "$path" || ${2:-} == replace ]] || fail 'Confirm replacement of this configuration.'
                    write_profile "$path" || fail 'Cannot save configuration. Previous data was kept.' ;;
                delete-profile) [[ ${2:-} == confirm ]] || fail 'Confirm deletion.'; rm -- "$path" || fail 'Cannot delete configuration.' ;;
            esac ;;
        stop-listeners) desktop_stop_listeners "${1:-}" ;;
        build-plan)
            desktop_dependencies "${1:-cpu}" || fail 'Automatic dependency installation is unavailable on this system.'
            python3 - "${MISSING_PACKAGES[@]}" <<'PY'
import json, sys
print(json.dumps(dict(packages=sys.argv[1:])))
PY
            return ;;
        latest) latest_build_tag; return ;;
        build-log) python3 "$MIR_ROOT/lib/desktop.py" log "$(build_root)/build.log"; return ;;
        build) (( $# == 3 )) || fail 'Choose release, backend and compiler jobs.'; desktop_build "$@"; return ;;
        restore)
            read_build "$LLAMA_CPP_PATH" && [[ -n "$BUILD_PREVIOUS" ]] || fail 'No previous managed build is available.'
            previous="$(build_root)/builds/$BUILD_PREVIOUS"
            activate_build "$previous" || fail 'Cannot restore the previous build. Current paths were kept.' ;;
        *) fail 'Unknown desktop operation.' ;;
    esac
    desktop_snapshot
}
