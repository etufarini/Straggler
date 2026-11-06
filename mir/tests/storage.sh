#!/usr/bin/env bash
# Storage failures must preserve files, active settings and profile association.
set -euo pipefail
MIR_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$MIR_ROOT/tests/helpers/core.sh"
load_test_core fake
setup_test_workspace
mkdir -p "$work/models" "$work/empty" "$work/other-models" \
    "$work/llama/bin" "$work/other-llama/build/bin"
touch "$work/models/first.gguf" "$work/models/selected.gguf" "$work/other-models/new.gguf" \
    "$work/llama/bin/llama-server" "$work/other-llama/build/bin/llama-server"
chmod +x "$work/llama/bin/llama-server" "$work/other-llama/build/bin/llama-server"
initialize_config "$work/models/selected.gguf"
LLAMA_CPP_PATH="$work/llama" MODELS_DIR="$work/models"
SERVER=$(server_path "$LLAMA_CPP_PATH")
save_paths
cp "$PATHS_FILE" "$work/paths.before"
write_profile "$PROFILES_DIR/Saved.conf"
profile_snapshot=$(profile_data)
association=$CURRENT_PROFILE
tracking=$SAVED_PROFILE
cmp -s "$association" <(profile_data)
cp "$association" "$work/profile.before"

for target in "$PROFILES_DIR/Other.conf" "$association"; do
    for failure in directory temporary serialization activation; do
        (
            expected=1
            case "$failure" in
                directory) mkdir() { return 1; }; expected=2 ;;
                temporary) mktemp() { return 1; }; expected=3 ;;
                serialization) profile_data() { printf 'model=partial\n'; return 1; } ;;
                activation) mv() { return 1; } ;;
            esac
            status=0
            write_profile "$target" || status=$?
            [[ $status == "$expected" && $CURRENT_PROFILE == "$association" && $SAVED_PROFILE == "$tracking" ]]
            [[ ! -e "$PROFILES_DIR/Other.conf" ]]
            cmp -s "$association" "$work/profile.before"
            temporary=("$PROFILES_DIR"/.profile.*)
            [[ ! -e ${temporary[0]} ]]
        )
    done
done
printf 'PASS: exact profile bytes and unchanged files/tracking on directory, temporary-file, serialization and activation failures\n'

# Malformed path files must not partially apply an earlier valid field.
for data in \
    '' \
    'llama_dir=changed' \
    $'llama_dir=changed\nmodels_dir=new\nunknown=value' \
    $'llama_dir=changed\nllama_dir=duplicate\nmodels_dir=new' \
    $'llama_dir=changed\nmalformed'; do
    printf '%s\n' "$data" > "$PATHS_FILE"
    if load_paths; then printf 'FAIL: malformed paths accepted\n' >&2; exit 1; fi
    [[ $LLAMA_CPP_PATH == "$work/llama" && $MODELS_DIR == "$work/models" ]]
done
literal_path="\$(touch executed)"
printf 'llama_dir=%s\nmodels_dir=literal value' "$literal_path" > "$PATHS_FILE"
load_paths
[[ $LLAMA_CPP_PATH == "$literal_path" && $MODELS_DIR == 'literal value' && ! -e executed ]]
LLAMA_CPP_PATH="$work/llama" MODELS_DIR="$work/models"
cp "$work/paths.before" "$PATHS_FILE"
load_paths
printf 'PASS: path data parsing, duplicate/unknown/malformed rejection and unterminated literal values\n'

# File-backed responses survive the subshells used by menus.
menu() {
    local choice
    IFS= read -r choice < "$work/queue" || return 255
    tail -n +2 "$work/queue" > "$work/queue.next"
    command mv -- "$work/queue.next" "$work/queue"
    printf '%s' "$choice"
}
select_folder() { printf '%s\n' "$FOLDER_CHOICE"; }
message() { printf '%s\n' "$*" >> "$work/messages"; }
ui() { return "$CONFIRM_STATUS"; }

for action in llama models; do
    if [[ $action == llama ]]; then FOLDER_CHOICE="$work/other-llama";
    else FOLDER_CHOICE="$work/other-models"; fi
    printf '%s\nback\n' "$action" > "$work/queue"
    mv() { return 1; }
    paths_menu
    unset -f mv
    cmp -s "$PATHS_FILE" "$work/paths.before"
    [[ $LLAMA_CPP_PATH == "$work/llama" && $MODELS_DIR == "$work/models" ]]
    [[ $SERVER == "$work/llama/bin/llama-server" && $(profile_data) == "$profile_snapshot" ]]
    [[ $CURRENT_PROFILE == "$association" && $SAVED_PROFILE == "$tracking" ]]
    [[ $(profile_status) == Saved && ! -s "$work/queue" ]]
    temporary=("$CONFIG_DIR"/.paths.*)
    [[ ! -e ${temporary[0]} ]]
done
[[ $(cat "$work/messages") == *'Cannot save paths'* ]]
printf 'PASS: failed atomic path replacement preserves both folders, server, profile and saved file\n'

FOLDER_CHOICE="$work/empty"
printf 'llama\nback\n' > "$work/queue"
paths_menu
cmp -s "$PATHS_FILE" "$work/paths.before"
[[ $LLAMA_CPP_PATH == "$work/llama" && $(profile_data) == "$profile_snapshot" ]]

FOLDER_CHOICE="$work/models"
printf 'models\nback\n' > "$work/queue"
paths_menu
[[ $MODEL == "$work/models/selected.gguf" && ${#MODELS[@]} == 2 && $(profile_status) == Saved ]]
FOLDER_CHOICE="$work/other-models"
printf 'models\nback\n' > "$work/queue"
paths_menu
[[ $MODEL == "$work/other-models/new.gguf" && ${#MODELS[@]} == 1 && $(profile_status) == 'Saved (Modified)' ]]
LLAMA_CPP_PATH='' MODELS_DIR=''
load_paths
[[ $LLAMA_CPP_PATH == "$work/llama" && $MODELS_DIR == "$work/other-models" ]]
FOLDER_CHOICE="$work/empty"
printf 'models\nback\n' > "$work/queue"
paths_menu
[[ -z $MODEL && ${#MODELS[@]} == 0 && ! -s "$work/queue" ]]
[[ $(cat "$work/messages") == *'No GGUF models found'* ]]
load_profile "$association"
printf 'PASS: invalid server folders, accepted model-folder refresh, selection retention and empty-folder recovery\n'

(
    # The save UI must reject names before they can become filesystem paths.
    ui() { printf '%s' "$TEST_NAME"; }
    for TEST_NAME in '' .hidden ../escape a/b -name "\$(touch executed)" $'line\nbreak' "$(printf 'Z%.0s' {1..81})"; do
        save_profile
        [[ $CURRENT_PROFILE == "$association" && $SAVED_PROFILE == "$tracking" ]]
        cmp -s "$association" "$work/profile.before"
        files=("$PROFILES_DIR"/*)
        [[ ${#files[@]} == 1 && ${files[0]} == "$association" && ! -e executed ]]
    done
    for TEST_NAME in A 'Name with spaces._-' "$(printf 'Z%.0s' {1..80})"; do
        save_profile
        [[ $CURRENT_PROFILE == "$PROFILES_DIR/$TEST_NAME.conf" && $(profile_status) == "$TEST_NAME" ]]
        cmp -s "$CURRENT_PROFILE" "$work/profile.before"
        command rm -- "$CURRENT_PROFILE"
    done
)
for action in save update; do
    (
        ui() { if [[ $* == *--inputbox* ]]; then printf Saved; else return 1; fi; }
        save_profile "$action"
        [[ $CURRENT_PROFILE == "$association" && $SAVED_PROFILE == "$tracking" ]]
        cmp -s "$association" "$work/profile.before"
    )
done
printf 'PASS: safe profile names, 80-character boundary and canceled replacement/update\n'

for operation in cancel failure success; do
    printf 'delete\n0\nback\n' > "$work/queue"
    CONFIRM_STATUS=0
    case "$operation" in
        cancel) CONFIRM_STATUS=1 ;;
        failure) rm() { return 1; } ;;
    esac
    configurations_menu
    unset -f rm
    [[ $(profile_data) == "$profile_snapshot" && ! -s "$work/queue" ]]
    if [[ $operation == success ]]; then
        [[ ! -e $association && -z $CURRENT_PROFILE && -z $SAVED_PROFILE ]]
        [[ $(profile_status) == 'Not saved' ]]
    else
        [[ -f $association && $CURRENT_PROFILE == "$association" && $SAVED_PROFILE == "$tracking" ]]
        [[ $(profile_status) == Saved ]]
        cmp -s "$association" <(printf '%s\n' "$profile_snapshot")
    fi
done
[[ $(cat "$work/messages") == *'Cannot delete configuration'* ]]
printf 'PASS: canceled/failed profile deletion preserves association; successful deletion clears it without changing settings\n'

# Import is a one-time copy, including profile bytes, without merging settings.
CONFIG_DIR="$work/migration/mir.cpp"
legacy="$work/migration/llama-launcher"
mkdir -p "$legacy/profiles"
cp "$work/paths.before" "$legacy/paths.conf"
cp "$work/profile.before" "$legacy/profiles/Old.conf"
for failure in copy activation; do
    (
        if [[ $failure == copy ]]; then cp() { return 1; };
        else mv() { return 1; }; fi
        if XDG_CONFIG_HOME="$work/migration" initialize_config "$work/models/selected.gguf"; then exit 99; fi
    ) > "$work/migration-error" 2>&1 && exit 1
    [[ $(cat "$work/migration-error") == *'Cannot import previous launcher settings'* ]]
    [[ ! -e $CONFIG_DIR ]]
    temporary=("${CONFIG_DIR%/*}"/.mir-migration.*)
    [[ ! -e ${temporary[0]} ]]
    cmp -s "$legacy/paths.conf" "$work/paths.before"
    cmp -s "$legacy/profiles/Old.conf" "$work/profile.before"
done
XDG_CONFIG_HOME="$work/migration" initialize_config "$work/models/selected.gguf"
cmp -s "$PATHS_FILE" "$legacy/paths.conf"
cmp -s "$PROFILES_DIR/Old.conf" "$legacy/profiles/Old.conf"
load_profile "$PROFILES_DIR/Old.conf"
[[ $(profile_status) == Old && $(profile_data) == "$profile_snapshot" ]]
printf later > "$legacy/profiles/Later.conf"
migrate_config
[[ ! -e $PROFILES_DIR/Later.conf ]]
printf changed > "$legacy/paths.conf"
migrate_config
cmp -s "$PATHS_FILE" "$work/paths.before"
command rm -rf -- "$CONFIG_DIR"
(
    mv() {
        mkdir -p "$CONFIG_DIR"
        printf existing > "$CONFIG_DIR/Existing"
        command mv "$@"
    }
    migrate_config
    [[ $(cat "$CONFIG_DIR/Existing") == existing && ! -e $PATHS_FILE ]]
)
temporary=("${CONFIG_DIR%/*}"/.mir-migration.*)
[[ ! -e ${temporary[0]} ]]
cmp -s "$legacy/profiles/Old.conf" "$work/profile.before"
printf 'PASS: atomic legacy import, preserved originals, existing-directory precedence and failure cleanup\n'
