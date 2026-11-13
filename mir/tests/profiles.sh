#!/usr/bin/env bash
# Profile persistence, compatibility defaults and transactional load rejection.
set -euo pipefail
MIR_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$MIR_ROOT/tests/helpers/core.sh"
load_test_core fake
setup_test_workspace
model="$work/model with spaces.gguf"
touch "$model"

initialize_config "$model"
CTX_SIZE=4096 DEVICE=Accelerator0 THREADS=3 GPU_LAYERS=12 PROMPT_PROCESSING=low-memory
CACHE_TYPE_K=q8_0 CACHE_TYPE_V=f16
build_model_args
model_args=$(printf '%s\n' "${MODEL_ARGS[@]}")
set_generation_preset focused
GENERATION[seed]=7 GENERATION[max_tokens]=2048
set_generation_preset min-p
[[ $(generation_preset) == min-p && ${GENERATION[seed]} == 7 && ${GENERATION[max_tokens]} == 2048 ]]
build_model_args
[[ $(printf '%s\n' "${MODEL_ARGS[@]}") == "$model_args" ]]
write_profile "$PROFILES_DIR/Generation.conf"
(( $(wc -l < "$PROFILES_DIR/Generation.conf") == 24 ))
saved=$(profile_data)
GENERATION[temperature]=0.8
[[ $(generation_preset) == custom && $(profile_status) == 'Generation (Modified)' ]]
load_profile "$PROFILES_DIR/Generation.conf"
[[ $(profile_data) == "$saved" && $(profile_status) == Generation && $(generation_preset) == min-p ]]
GENERATION[seed]=8
[[ $(profile_status) == 'Generation (Modified)' ]]
GENERATION[seed]=7
[[ $(profile_status) == Generation ]]
before=$(profile_data)
for value in 'temperature=nan' 'top_p=2' 'seed=4294967296' 'max_tokens=-2'; do
    field=${value%%=*}
    while IFS= read -r line; do
        if [[ "$line" == "$field="* ]]; then printf '%s\n' "$value"; else printf '%s\n' "$line"; fi
    done < "$PROFILES_DIR/Generation.conf" > "$PROFILES_DIR/Invalid.conf"
    if load_profile "$PROFILES_DIR/Invalid.conf"; then exit 1; fi
    [[ $(profile_data) == "$before" && $(profile_status) == Generation ]]
done
rm "$PROFILES_DIR/Generation.conf" "$PROFILES_DIR/Invalid.conf"
printf 'PASS: generation profile round trips, transactional rejection and sampling isolation\n'

export MIR_PORT=11000 MIR_CACHE_TYPE_K=f32 MIR_CACHE_TYPE_V=q8_0
export MIR_GENERATION_PRESET=exploratory LLAMA_ARG_CACHE_TYPE_V=f16
export MIR_SPLIT_MODE=row MIR_TENSOR_SPLIT=3,1 MIR_FIT_TARGET=4096
initialize_config "$model"
CTX_SIZE=8192 PORT=10001 DEVICE=Vulkan1,Vulkan0 THREADS=4 GPU_LAYERS=12
PROMPT_PROCESSING=large-batch CACHE_TYPE_K=q8_0 CACHE_TYPE_V=f16
SPLIT_MODE=layer TENSOR_SPLIT=2,1 FIT_TARGET=2048,1024
set_generation_preset focused
GENERATION[seed]=42 GENERATION[max_tokens]=1024
write_profile "$PROFILES_DIR/Complete.conf"
complete=$(profile_data)
for field in model context port device threads gpu_layers prompt_processing cache_type_k cache_type_v split_mode tensor_split fit_target chat_system_prompt chat_reasoning chat_reasoning_effort "${GENERATION_KEYS[@]}"; do
    load_profile "$PROFILES_DIR/Complete.conf"
    before=$(profile_data)
    tracking=$SAVED_PROFILE
    while IFS= read -r line; do
        [[ "$line" == "$field="* ]] || printf '%s\n' "$line"
    done < "$CURRENT_PROFILE" > "$PROFILES_DIR/Partial.conf"
    if [[ "$field" == model ]]; then
        if load_profile "$PROFILES_DIR/Partial.conf"; then exit 1; fi
        [[ $(profile_data) == "$before" && $SAVED_PROFILE == "$tracking" && $(profile_status) == Complete ]]
    else
        case "$field" in chat_system_prompt) default='""' ;; port) default=9931 ;; cache_type_k|cache_type_v) default=q4_0 ;; *) default=auto ;; esac
        expected=$(printf '%s\n' "$complete" | sed "s/^$field=.*/$field=$default/")
        load_profile "$PROFILES_DIR/Partial.conf"
        [[ $(profile_data) == "$expected" && $(profile_status) == Partial ]]
    fi
    load_profile "$PROFILES_DIR/Complete.conf"
    # Duplicate recognized fields remain errors even when both values are valid.
    printf '%s\n' "$complete" > "$PROFILES_DIR/Duplicate.conf"
    while IFS= read -r line; do
        if [[ "$line" == "$field="* ]]; then printf '%s\n' "$line"; fi
    done < "$CURRENT_PROFILE" >> "$PROFILES_DIR/Duplicate.conf"
    if load_profile "$PROFILES_DIR/Duplicate.conf"; then exit 1; fi
    [[ $(profile_data) == "$complete" && $SAVED_PROFILE == "$complete" && $(profile_status) == Complete ]]
done
# A model-only profile resets every optional control, including environment overrides.
printf 'model=%s\n' "$model" > "$PROFILES_DIR/Minimal.conf"
load_profile "$PROFILES_DIR/Minimal.conf"
[[ $CTX_SIZE == auto && $PORT == 9931 && $DEVICE == auto && $THREADS == auto && $GPU_LAYERS == auto ]]
[[ $PROMPT_PROCESSING == auto && $CACHE_TYPE_K == q4_0 && $CACHE_TYPE_V == q4_0 ]]
[[ $SPLIT_MODE == auto && $TENSOR_SPLIT == auto && $FIT_TARGET == auto ]]
for key in "${GENERATION_KEYS[@]}"; do [[ ${GENERATION[$key]} == auto ]]; done
defaults=$(profile_data)
[[ $(profile_status) == Minimal ]]
# Old and future fields are ignored literally, including duplicate unknown keys.
printf '%s\n' "$complete" 'removed_control=auto' 'removed_control=off' "future_control=\$(touch executed)" "\$(touch executed)=ignored" > "$PROFILES_DIR/Compatible.conf"
original=$(cat "$PROFILES_DIR/Compatible.conf")
load_profile "$PROFILES_DIR/Compatible.conf"
[[ $(profile_data) == "$complete" && $(profile_status) == Compatible && ! -e executed ]]
[[ $(cat "$CURRENT_PROFILE") == "$original" ]]
write_profile "$PROFILES_DIR/Resaved.conf"
[[ $(cat "$CURRENT_PROFILE") == "$complete" ]]
# Reject malformed input and invalid recognized fields without changing state.
for value in 'malformed line without separator' 'model=' "model=$model.missing.gguf" 'context=' 'port=' 'device=' 'threads=' 'gpu_layers=' 'prompt_processing=' 'cache_type_k=' 'cache_type_v=' 'split_mode=' 'tensor_split=' 'fit_target=' 'chat_system_prompt={}' 'chat_reasoning=maybe' 'chat_reasoning_effort=NOT_VALID' "temperature=\$(touch executed)"; do
    field=${value%%=*}
    while IFS= read -r line; do
        [[ "$line" == "$field="* ]] || printf '%s\n' "$line"
    done < "$CURRENT_PROFILE" > "$PROFILES_DIR/Invalid.conf"
    printf '%s\n' "$value" >> "$PROFILES_DIR/Invalid.conf"
    if load_profile "$PROFILES_DIR/Invalid.conf"; then exit 1; fi
    [[ $(profile_data) == "$complete" && $SAVED_PROFILE == "$complete" && $(profile_status) == Resaved && ! -e executed ]]
done
printf 'model=%s' "$model" > "$PROFILES_DIR/Minimal.conf"
load_profile "$PROFILES_DIR/Minimal.conf"
[[ $(profile_data) == "$defaults" ]]
printf 'PASS: all profile fields, independent defaults, unknown literal data and atomic rejection\n'
