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

# Names are checked by the bridge before becoming filesystem paths.
# shellcheck disable=SC2016 # Reject literal shell syntax in names.
for name in '' .hidden ../escape a/b -name '$(touch executed)' "$(printf 'Z%.0s' {1..81})"; do
    if valid_profile_name "$name"; then exit 1; fi
done
for name in A 'Name with spaces._-' "$(printf 'Z%.0s' {1..80})"; do valid_profile_name "$name"; done
printf 'PASS: safe profile names and 80-character boundary\n'
