#!/usr/bin/env bash
set -euo pipefail
MIR_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$MIR_ROOT/lib/runtime.sh"
configure_runtime check
if [[ "$RUNTIME_BASH" != "$BASH" ]]; then exec "$RUNTIME_BASH" "${BASH_SOURCE[0]}" "$@"; fi
# Test subprocesses use the same compatible interpreter as this runner.
export PATH="${BASH%/*}:$PATH"
suite=${1:-all}
case "$suite" in common|linux|macos|desktop|native|packaging|all) ;; *) printf 'Usage: bash mir/tests/run.sh [common|linux|macos|desktop|native|packaging|all]\n' >&2; exit 1 ;; esac
if (( $# > 1 )); then exit 1; fi
lint_pids=()
finish_lint() {
    local pid status=0
    for pid in "${lint_pids[@]}"; do wait "$pid" || status=1; done
    lint_pids=()
    return "$status"
}
trap finish_lint EXIT
lint_adapter() {
    "$BASH" -n "$MIR_ROOT/lib/platform/$1.sh"
    if command -v shellcheck >/dev/null; then shellcheck "$MIR_ROOT/lib/platform/$1.sh"; fi
}
run() {
    printf '\nChecking %s\n' "$1"
    if ! "$BASH" "$MIR_ROOT/tests/$1" "${@:2}"; then
        printf 'FAIL: %s\n' "$1" >&2
        return 1
    fi
}
if [[ "$suite" == common || "$suite" == all ]]; then
    run architecture.sh
    python3 -I "$MIR_ROOT/desktop/tests/test_macos_packaging.py"
    python3 -I "$MIR_ROOT/desktop/tests/test_ubuntu_packaging.py"
    test_scripts=("$MIR_ROOT"/tests/*.sh "$MIR_ROOT"/tests/helpers/*.sh "$MIR_ROOT"/tests/platform/*.sh "$MIR_ROOT"/tests/native/*.sh)
    source_scripts=("$MIR_ROOT/mir.sh" "$MIR_ROOT"/lib/*.sh "$MIR_ROOT"/sh/*.sh)
    if command -v shellcheck >/dev/null; then
        # Follow modules from the entry point so lint sees their shared state.
        # Two bounded groups avoid serially repeating module analysis per test.
        lint_files=("$MIR_ROOT/mir.sh" "$MIR_ROOT"/sh/*.sh "${test_scripts[@]}")
        first=(); second=()
        for index in "${!lint_files[@]}"; do
            if (( index % 2 )); then second+=("${lint_files[index]}");
            else first+=("${lint_files[index]}"); fi
        done
        shellcheck -x -P "$MIR_ROOT" -P SCRIPTDIR "${first[@]}" &
        lint_pids+=("$!")
        shellcheck -x -P "$MIR_ROOT" -P SCRIPTDIR "${second[@]}" &
        lint_pids+=("$!")
    else
        printf 'SKIP: ShellCheck is not installed\n'
    fi
    for file in "${source_scripts[@]}" "${test_scripts[@]}"; do "$BASH" -n "$file"; done
    run config.sh
    run profiles.sh
    run storage.sh
    run models.sh
    run processes.sh
    run regression.sh
    run portability.sh
    run memory.sh
    run bootstrap.sh
    finish_lint
fi
if [[ "$suite" == packaging ]]; then
    python3 -I "$MIR_ROOT/desktop/tests/test_macos_packaging.py"
    python3 -I "$MIR_ROOT/desktop/tests/test_ubuntu_packaging.py"
    cargo test --locked --manifest-path "$MIR_ROOT/desktop/src-tauri/Cargo.toml" --no-default-features --test bundled_backend --test direct_start
    if [[ "$PLATFORM_ID" == macos ]]; then
        cargo test --locked --manifest-path "$MIR_ROOT/desktop/src-tauri/Cargo.toml" --no-default-features --features app-store --test store_distribution
    fi
fi
if [[ "$suite" == linux || "$suite" == all ]]; then
    lint_adapter linux
    run platform/linux.sh
    run build.sh
    run installation.sh Linux
    run native/linux.sh
fi
if [[ "$suite" == macos || "$suite" == all ]]; then
    lint_adapter macos
    run platform/macos.sh
    run platform/macos-build.sh
    run build.sh macos
    run installation.sh Darwin
    run native/macos.sh
fi

if [[ "$suite" == desktop || "$suite" == all || "$suite" == native ]]; then
    for tool in npm cargo python3; do
        command -v "$tool" >/dev/null || { printf 'Missing developer tool: %s. See mir/desktop/README.md.\n' "$tool" >&2; exit 1; }
    done
    cd -- "$MIR_ROOT/desktop"
    if [[ ! -d node_modules ]]; then npm ci --no-audit --no-fund; fi
    if [[ "$suite" == native ]]; then
        npm run test:native
    else
        npm run format:check
        npm run lint
        npm run build
        cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
        cargo clippy --locked --manifest-path src-tauri/Cargo.toml --no-default-features --all-targets -- -D warnings
        npm test
        npm run test:runtime
        if [[ "$PLATFORM_ID" == macos ]]; then
            cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features --features app-store --test store_distribution
            cargo clippy --locked --manifest-path src-tauri/Cargo.toml --features app-store --all-targets -- -D warnings
        fi
        npm exec -- playwright install chromium webkit
        npm run test:e2e
    fi
fi

if [[ "$suite" == all ]]; then
    if [[ "$PLATFORM_ID" == linux && -z ${DISPLAY:-} && -z ${WAYLAND_DISPLAY:-} ]]; then
        if command -v xvfb-run >/dev/null; then
            xvfb-run -a "$BASH" "$MIR_ROOT/tests/run.sh" native
        else
            printf 'SKIP: native GUI needs a graphical session or xvfb-run; CI runs this check.\n'
        fi
    else
        npm run test:native
    fi
fi
