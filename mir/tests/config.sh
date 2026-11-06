#!/usr/bin/env bash
# Validator boundaries run without launching servers or probing the host.
set -euo pipefail
MIR_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$MIR_ROOT/tests/helpers/core.sh"
load_test_core fake

check_values() {
    local expected=$1 validator=$2 value status
    shift 2
    for value in "$@"; do
        status=0
        "$validator" "$value" || status=$?
        if [[ $status != "$expected" ]]; then
            printf 'FAIL: %s %q returned %s, expected %s\n' "$validator" "$value" "$status" "$expected" >&2
            exit 1
        fi
    done
}

check_values 0 valid_context auto 0 256 1024 2147483647
check_values 1 valid_context '' -1 01 2147483648 999999999999999999999999 '1+1'
check_values 0 valid_threads auto 1 2147483647
check_values 1 valid_threads '' 0 01 -1 2147483648 '1+1'
check_values 0 valid_layers auto all 0 2147483647
check_values 1 valid_layers '' -1 01 2147483648
check_values 0 valid_port 1 09931 65535
check_values 1 valid_port '' 0 -1 65536 999999 '1+1'

ratios() { valid_gpu_list ratios "$1"; }
margins() { valid_gpu_list margins "$1"; }
literal_input="\$(touch executed)"
check_values 0 valid_split_mode auto none layer row tensor
check_values 1 valid_split_mode '' bogus LAYER "$literal_input"
check_values 0 ratios auto 0,1 0.5,1.25 2147483647,1
check_values 1 ratios '' 0 0,0.0 -1,2 1, 1,,2 1/2 01,2 nan,1 1e2,1 \
    2147483648,1 1.1234567890,1 "$literal_input"
check_values 0 margins auto 0 2048,1024 2147483647
check_values 1 margins '' -1 1.5 01 1, 1,,2 2147483648 "$literal_input"
check_values 0 valid_cache_type f32 f16 bf16 q8_0 q4_0 q4_1 iq4_nl q5_0 q5_1 custom_type
check_values 1 valid_cache_type '' Q4_0 'q4_0 q8_0' "$literal_input" --port
printf 'PASS: context, threads, layers, port, GPU ratio/margin and cache type boundaries\n'

generation_value() { valid_generation_value "$GENERATION_FIELD" "$1"; }
for GENERATION_FIELD in temperature top_p top_k min_p repeat_penalty presence_penalty frequency_penalty seed max_tokens; do
    check_values 0 generation_value auto
    check_values 1 generation_value '' "$literal_input"
done
GENERATION_FIELD=temperature
check_values 0 generation_value 0 0.75 2147483647.999999999
check_values 1 generation_value -0.1 nan 01.5 1.1234567890
GENERATION_FIELD=top_p
check_values 0 generation_value 0 1.000
check_values 1 generation_value 1.01
GENERATION_FIELD=min_p
check_values 0 generation_value 0 1
check_values 1 generation_value -0.1
GENERATION_FIELD=top_k
check_values 0 generation_value 0 2147483647
check_values 1 generation_value 1.5 2147483648
GENERATION_FIELD=repeat_penalty
check_values 0 generation_value 0.01 1
check_values 1 generation_value 0 -1
GENERATION_FIELD=presence_penalty
check_values 0 generation_value -0.5 -2147483647.999999999
check_values 1 generation_value --1 -2147483648
GENERATION_FIELD=frequency_penalty
check_values 0 generation_value 0.2 -0
check_values 1 generation_value -0.1234567890
GENERATION_FIELD=seed
check_values 0 generation_value -1 0 4294967295
check_values 1 generation_value -2 4294967296
GENERATION_FIELD=max_tokens
check_values 0 generation_value -1 0 2147483647
check_values 1 generation_value -2 2147483648
printf 'PASS: generation integer/decimal boundaries, signed values and literal input rejection\n'

setup_test_workspace
model="$work/model.gguf"
touch "$model"
check_values 0 valid_device auto none Arbitrary0 Other.backend:1 Arbitrary1,Arbitrary0
check_values 1 valid_device '' 'GPU 0' 'GPU0,' ',GPU0' 'GPU0,,GPU1' "$literal_input"

# Check initialization directly, with independent expected values for each alias.
while read -r suffix target value; do
    for naming in legacy current; do
        (
            legacy="LLAMA_$suffix"
            if [[ $suffix == LLAMA_CPP_DIR ]]; then legacy=LLAMA_CPP_DIR; fi
            printf -v "$legacy" '%s' "$value"
            if [[ $naming == current ]]; then
                printf -v "$legacy" '%s' bad
                printf -v "MIR_$suffix" '%s' "$value"
            fi
            initialize_config "$model"
            case "$target" in
                generation_preset) actual=$(generation_preset) ;;
                generation:*) actual=${GENERATION[${target#*:}]} ;;
                *) actual=${!target} ;;
            esac
            [[ $actual == "$value" ]] || {
                printf 'FAIL: %s %s resolved to %q, expected %q\n' "$naming" "$suffix" "$actual" "$value" >&2
                exit 1
            }
        )
    done
done <<'CONTROLS'
LLAMA_CPP_DIR LLAMA_CPP_PATH /literal/server
MODELS_DIR MODELS_DIR /literal/models
CTX_SIZE CTX_SIZE 8192
PORT PORT 10002
DEVICE DEVICE none
THREADS THREADS 3
GPU_LAYERS GPU_LAYERS 12
PROMPT_PROCESSING PROMPT_PROCESSING low-memory
HOST SERVER_HOST ::1
GENERATION_PRESET generation_preset focused
TEMPERATURE generation:temperature 0.7
TOP_P generation:top_p 0.9
TOP_K generation:top_k 30
MIN_P generation:min_p 0.05
REPEAT_PENALTY generation:repeat_penalty 1.1
PRESENCE_PENALTY generation:presence_penalty -0.2
FREQUENCY_PENALTY generation:frequency_penalty 0.2
SEED generation:seed 42
MAX_TOKENS generation:max_tokens 2048
CONTROLS

MIR_HOST=$'$(touch executed)\n'
literal=''
read_launcher_control literal HOST default
[[ $literal == "$MIR_HOST" && ! -e executed ]]
unset MIR_HOST
export MIR_THREADS=3
initialize_config "$model"
[[ $THREADS == 3 && ! -v LLAMA_THREADS ]]
MIR_THREADS=4
initialize_config "$model"
[[ $THREADS == 4 && ! -v LLAMA_THREADS ]]
export LLAMA_THREADS=7 MIR_THREADS=''
initialize_config "$model"
[[ -z $THREADS ]]
unset MIR_THREADS
LLAMA_THREADS=''
initialize_config "$model"
[[ $THREADS == auto ]]
export LLAMA_TEMPERATURE=0.7 MIR_TEMPERATURE=''
initialize_config "$model"
[[ -z ${GENERATION[temperature]} ]]
printf 'PASS: current/legacy controls, explicit empties, literal values and repeated initialization\n'
