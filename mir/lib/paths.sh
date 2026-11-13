#!/usr/bin/env bash

server_path() {
    local folder=$1 candidate
    [[ -n "$folder" ]] || return 0
    for candidate in "$folder/build/bin/llama-server" "$folder/bin/llama-server"; do
        if [[ -f "$candidate" && -x "$candidate" ]]; then printf '%s' "$candidate"; return 0; fi
    done
    printf '%s/build/bin/llama-server' "$folder"
}

# Stage beside the destination so migration can activate atomically.
migrate_config() {
    local legacy="${CONFIG_DIR%/*}/llama-launcher" temporary
    if [[ -e "$CONFIG_DIR" || -L "$CONFIG_DIR" ]]; then return 0; fi
    [[ -d "$legacy" ]] || return 0
    mkdir -p -- "${CONFIG_DIR%/*}" || return 1
    temporary=$(mktemp -d "${CONFIG_DIR%/*}/.mir-migration.XXXXXXXX") || return 1
    if cp -a -- "$legacy/." "$temporary/" && platform_move "$temporary" "$CONFIG_DIR" no-clobber; then
        # With no-clobber, a concurrently created destination leaves the stage.
        [[ ! -d "$temporary" ]] || rm -rf -- "$temporary"
        return 0
    fi
    rm -rf -- "$temporary"
    return 1
}

load_paths() {
    local line key
    local -A paths=()
    [[ -r "$PATHS_FILE" ]] || return 1
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ "$line" == *=* ]] || return 1
        key="${line%%=*}"
        case "$key" in llama_dir|models_dir) ;; *) return 1 ;; esac
        [[ ! -v "paths[$key]" ]] || return 1
        paths[$key]="${line#*=}"
    done < "$PATHS_FILE"
    (( ${#paths[@]} == 2 )) || return 1
    LLAMA_CPP_PATH="${paths[llama_dir]}"
    MODELS_DIR="${paths[models_dir]}"
}
