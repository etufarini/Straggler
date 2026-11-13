#!/usr/bin/env bash
# Saved paths are read transactionally as literal data for direct startup.
set -euo pipefail
MIR_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$MIR_ROOT/tests/helpers/core.sh"
load_test_core fake
setup_test_workspace
initialize_config "$work/models/selected.gguf"
LLAMA_CPP_PATH="$work/llama" MODELS_DIR="$work/models"
mkdir -p "$CONFIG_DIR"
printf 'llama_dir=%s\nmodels_dir=%s\n' "$LLAMA_CPP_PATH" "$MODELS_DIR" > "$PATHS_FILE"
cp "$PATHS_FILE" "$work/paths.before"

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
