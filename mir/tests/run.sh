#!/usr/bin/env bash
# Development checks only; compatible with the system Bash on macOS and Linux.
set -euo pipefail
desktop="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../desktop" && pwd)"
suite=${1:-all}
if (( $# > 1 )); then
    printf 'Expected at most one suite.\n' >&2
    exit 1
fi
case "$suite" in
    desktop|native|packaging|all) ;;
    *) printf 'Usage: bash mir/tests/run.sh [desktop|native|packaging|all]\n' >&2; exit 1 ;;
esac
cd -- "$desktop"

packaging_checks() {
    python3 -I tests/test_macos_packaging.py
    python3 -I tests/test_ubuntu_packaging.py
    cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features --test bundled_backend
    if [[ $(uname -s) == Darwin ]]; then
        cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features --features app-store --test store_distribution
    fi
}

if [[ "$suite" == packaging || "$suite" == all ]]; then
    packaging_checks
fi
if [[ "$suite" == desktop || "$suite" == all ]]; then
    bash -n ../tests/run.sh
    if command -v shellcheck >/dev/null; then
        shellcheck ../tests/run.sh
    else
        printf 'SKIP: ShellCheck is not installed.\n'
    fi
    npm run format:check
    npm run lint
    npm run build
    cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
    cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
    npm test
    npm run test:runtime
    if [[ $(uname -s) == Darwin ]]; then
        cargo clippy --locked --manifest-path src-tauri/Cargo.toml --features app-store --all-targets -- -D warnings
    fi
    npm run test:e2e
fi
if [[ "$suite" == native || "$suite" == all ]]; then
    if [[ $(uname -s) == Linux && -z ${DISPLAY:-} && -z ${WAYLAND_DISPLAY:-} ]]; then
        if command -v xvfb-run >/dev/null && command -v dbus-run-session >/dev/null; then
            LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 xvfb-run -a dbus-run-session -- npm run test:native
        elif [[ "$suite" == native ]]; then
            printf 'Native checks require a graphical session or xvfb-run and dbus-run-session.\n' >&2
            exit 1
        else
            printf 'SKIP: native window needs a graphical session or xvfb-run and dbus-run-session; CI runs this check.\n'
        fi
    else
        npm run test:native
    fi
fi
