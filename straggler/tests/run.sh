#!/usr/bin/env bash
# Development checks only; compatible with the system Bash on macOS and Linux.
set -euo pipefail
desktop="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../desktop" && pwd)"
runner="$desktop/../tests/run.sh"
suite=${1:-all}
if (( $# > 1 )); then
    printf 'Expected at most one suite.\n' >&2
    exit 1
fi
case "$suite" in
    common|frontend|runtime|browser|browser-platform|desktop|isolation|native|packaging|all) ;;
    *) printf 'Usage: bash straggler/tests/run.sh [common|frontend|runtime|browser|browser-platform|desktop|isolation|native|packaging|all]\n' >&2; exit 1 ;;
esac
cd -- "$desktop"

require_tools() {
    local tool
    for tool in "$@"; do
        command -v "$tool" >/dev/null || {
            printf 'Missing developer tool: %s. See straggler/desktop/README.md.\n' "$tool" >&2
            return 1
        }
    done
}

archive_checks() {
    require_tools python3
    python3 -I tests/test_macos_packaging.py
    python3 -I tests/test_ubuntu_packaging.py
}

if [[ "$suite" == common || "$suite" == all ]]; then
    bash -n "$runner"
    if command -v shellcheck >/dev/null; then
        shellcheck "$runner"
    else
        printf 'SKIP: ShellCheck is not installed.\n'
    fi
    archive_checks
    python3 -I tests/test_runner.py
fi
if [[ "$suite" == packaging ]]; then
    require_tools cargo python3
    archive_checks
    cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features --test bundled_backend
    if [[ $(uname -s) == Darwin ]]; then
        cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features --features app-store --test store_distribution
    fi
fi
if [[ "$suite" == frontend || "$suite" == desktop || "$suite" == all ]]; then
    require_tools npm
    npm run format:check
    npm run lint
    npm run build
    npm test
fi
if [[ "$suite" == runtime || "$suite" == desktop || "$suite" == all ]]; then
    require_tools cargo python3
    cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
    cargo clippy --locked --manifest-path src-tauri/Cargo.toml --no-default-features --all-targets -- -D warnings
    # Process fixtures inspect and briefly bind native sockets. Isolate their
    # lifetimes; tests that exercise concurrency still create their own workers.
    cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features -- --test-threads=1
    if [[ $(uname -s) == Darwin ]]; then
        cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features --features app-store --test store_distribution
    fi
fi
if [[ "$suite" == browser || "$suite" == desktop || "$suite" == all ]]; then
    require_tools npm
    npm run test:e2e
fi
if [[ "$suite" == browser-platform ]]; then
    require_tools npm
    npm run test:e2e -- --grep @platform
fi
if [[ "$suite" == isolation ]]; then
    require_tools cargo python3
    python3 -I tests/test_desktop_isolation.py
fi
if [[ "$suite" == native || "$suite" == all ]]; then
    if [[ $(uname -s) == Linux && -z ${DISPLAY:-} && -z ${WAYLAND_DISPLAY:-} ]]; then
        if command -v xvfb-run >/dev/null && command -v dbus-run-session >/dev/null; then
            LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 \
                xvfb-run -a dbus-run-session -- "$BASH" "$runner" native
        elif [[ "$suite" == native ]]; then
            printf 'Native checks require a graphical session or xvfb-run and dbus-run-session.\n' >&2
            exit 1
        else
            printf 'SKIP: native window needs a graphical session or xvfb-run and dbus-run-session; CI runs this check.\n'
        fi
    else
        require_tools cargo python3 npm
        python3 -I tests/test_desktop_isolation.py
        cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
        if [[ $(uname -s) == Darwin ]]; then
            cargo clippy --locked --manifest-path src-tauri/Cargo.toml --features app-store --all-targets -- -D warnings
        fi
        npm run test:native
    fi
fi
