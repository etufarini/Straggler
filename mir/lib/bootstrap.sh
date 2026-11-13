#!/usr/bin/env bash
# Prepare an embedded desktop build for both source and installed entry points.

desktop_fetch() {
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
        --connect-timeout 15 --max-time 600 --retry 2 "$1" --output "$2"
}

desktop_toolchains() {
    local tools=$1 node_arch rust_target stage filename digest version system
    system=$(platform_node_system)
    mkdir -p -- "$tools" || return 1
    if ! command -v node >/dev/null || ! command -v npm >/dev/null ||
        ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit((a===22&&b>=13)||a===24||a>=26?0:1)' 2>/dev/null; then
        case "$(uname -m)" in x86_64) node_arch=x64 ;; aarch64|arm64) node_arch=arm64 ;; *) fail 'Automatic Node.js preparation supports x86_64 and arm64 Linux/macOS.' ;; esac
        if [[ ! -x "$tools/node/bin/node" ]]; then
            printf 'Preparing Node.js for Mir.cpp...\n' >&2
            stage=$(mktemp -d "$tools/.node.XXXXXXXX") || return 1
            desktop_fetch https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt "$stage/checksums" || { rm -rf -- "$stage"; return 1; }
            filename=$(awk -v arch="$node_arch" -v os="$system" '$2 ~ "^node-v[0-9]+\\.[0-9]+\\.[0-9]+-" os "-" arch "\\.tar\\.gz$" {print $2}' "$stage/checksums")
            [[ "$filename" =~ ^node-v[0-9]+\.[0-9]+\.[0-9]+-(linux|darwin)-(x64|arm64)\.tar\.gz$ ]] || { rm -rf -- "$stage"; fail 'Cannot identify the official Node.js archive.'; }
            digest=$(awk -v file="$filename" '$2 == file {print $1}' "$stage/checksums")
            desktop_fetch "https://nodejs.org/dist/latest-v24.x/$filename" "$stage/node.tar.gz" || { rm -rf -- "$stage"; return 1; }
            platform_helper checksum "$stage/node.tar.gz" "$digest" || { rm -rf -- "$stage"; fail 'Node.js archive checksum failed.'; }
            mkdir "$stage/runtime" || { rm -rf -- "$stage"; return 1; }
            tar -xzf "$stage/node.tar.gz" --no-same-owner --strip-components=1 -C "$stage/runtime" || { rm -rf -- "$stage"; return 1; }
            replace_path "$stage/runtime" "$tools/node" || { rm -rf -- "$stage"; return 1; }
            rm -rf -- "$stage"
        fi
        export PATH="$tools/node/bin:$PATH"
    fi
    version=$(rustc --version 2>/dev/null | awk '{print $2}') || version=''
    if ! command -v cargo >/dev/null || ! platform_helper version "$version" 1.92.0; then
        case "$(uname -m)" in x86_64) rust_target=x86_64 ;; aarch64|arm64) rust_target=aarch64 ;; *) fail 'Automatic Rust preparation supports x86_64 and arm64 Linux/macOS.' ;; esac
        if [[ "$system" == darwin ]]; then rust_target+=-apple-darwin;
        else rust_target+=-unknown-linux-gnu; fi
        export CARGO_HOME="$tools/rust/cargo" RUSTUP_HOME="$tools/rust/rustup"
        if [[ ! -x "$CARGO_HOME/bin/rustup" ]]; then
            printf 'Preparing the Rust compiler for Mir.cpp...\n' >&2
            stage=$(mktemp -d "$tools/.rust.XXXXXXXX") || return 1
            if ! desktop_fetch "https://static.rust-lang.org/rustup/dist/$rust_target/rustup-init" "$stage/rustup-init" ||
                ! desktop_fetch "https://static.rust-lang.org/rustup/dist/$rust_target/rustup-init.sha256" "$stage/checksum"; then rm -rf -- "$stage"; return 1; fi
            read -r digest _ < "$stage/checksum"
            if [[ ! "$digest" =~ ^[a-f0-9]{64}$ ]] || ! platform_helper checksum "$stage/rustup-init" "$digest"; then rm -rf -- "$stage"; fail 'Rust installer checksum failed.'; fi
            chmod +x "$stage/rustup-init" || { rm -rf -- "$stage"; return 1; }
            "$stage/rustup-init" -y --no-modify-path --profile minimal --default-toolchain stable >&2 || { rm -rf -- "$stage"; return 1; }
            rm -rf -- "$stage"
        else
            "$CARGO_HOME/bin/rustup" update stable >&2 || return 1
        fi
        export PATH="$CARGO_HOME/bin:$PATH"
    fi
}

desktop_compile() {
    cd -- "$1/desktop" || return 1
    export CARGO_TARGET_DIR=$2
    npm ci --no-audit --no-fund >&2 && npm run build >&2 &&
        cargo build --locked --release --features custom-protocol --manifest-path src-tauri/Cargo.toml >&2 &&
        "$CARGO_TARGET_DIR/release/mir-desktop" --mir-check >/dev/null || return 1
    if [[ "$PLATFORM_ID" == macos ]]; then
        npm exec -- tauri bundle --bundles app --features custom-protocol >&2 || return 1
        "$CARGO_TARGET_DIR/release/bundle/macos/Mir.cpp.app/Contents/MacOS/mir-desktop" --mir-check >/dev/null || return 1
    fi
}

prepare_desktop() {
    local cache="${XDG_CACHE_HOME:-$HOME/.cache}/mir.cpp/desktop" tools="${XDG_DATA_HOME:-$HOME/.local/share}/mir.cpp/toolchains"
    local identity binary stage artifact=mir-desktop result=0 worker='' worker_identity='' interrupted=0
    platform_ensure_dependencies desktop-runtime >&2 || exit 1
    tools+="/$(uname -s)-$(uname -m)"
    identity=$(python3 "$MIR_ROOT/lib/desktop.py" fingerprint "$MIR_ROOT") || exit 1
    [[ "$cache" == /* && "$tools" == /* ]] || fail 'User cache and data directories must be absolute.'
    mkdir -p -- "$cache" || exit 1
    binary="$cache/$identity/mir-desktop"
    if [[ "$PLATFORM_ID" == macos ]]; then
        artifact=Mir.cpp.app
        binary="$cache/$identity/$artifact/Contents/MacOS/mir-desktop"
    fi
    if [[ -x "$binary" ]] && "$binary" --mir-check >/dev/null 2>&1; then GUI_BINARY=$binary; return 0; fi
    exec 8> "$cache/.build.flock" || exit 1
    platform_lock wait 8 || exit 1
    if [[ -x "$binary" ]] && "$binary" --mir-check >/dev/null 2>&1; then GUI_BINARY=$binary; platform_lock unlock 8; exec 8>&-; return 0; fi
    platform_ensure_dependencies desktop >&2 || exit 1
    desktop_toolchains "$tools" || exit 1
    stage=$(mktemp -d "$cache/.prepare.XXXXXXXX") || exit 1
    stop_preparation() {
        trap '' INT TERM HUP
        if [[ -n "$worker" && -n "$worker_identity" && $(ps -p "$worker" -o lstart= 2>/dev/null) == "$worker_identity" ]]; then
            kill -TERM -- "-$worker" 2>/dev/null || true
        fi
        [[ -z "$worker" ]] || wait "$worker" 2>/dev/null || true
        rm -rf -- "$stage"
    }
    trap 'result=$?; stop_preparation; exit "$result"' EXIT
    trap 'interrupted=130' INT
    trap 'interrupted=143' TERM HUP
    mkdir -p "$stage/desktop/src-tauri" || exit 1
    cp -- "$MIR_ROOT/mir.sh" "$stage/" || exit 1
    cp -a -- "$MIR_ROOT/lib" "$MIR_ROOT/sh" "$stage/" || exit 1
    cp -- "$MIR_ROOT/desktop/"{package.json,package-lock.json,index.html,tsconfig.json,vite.config.ts} "$stage/desktop/" || exit 1
    cp -a -- "$MIR_ROOT/desktop/src" "$stage/desktop/" || exit 1
    mkdir -p -- "$stage/desktop/packaging" || exit 1
    cp -- "$MIR_ROOT/desktop/packaging/llama-runtime.json" "$stage/desktop/packaging/" || exit 1
    cp -- "$MIR_ROOT/desktop/src-tauri/"{Cargo.toml,Cargo.lock,build.rs,tauri.conf.json,tauri.macos.conf.json} "$stage/desktop/src-tauri/" || exit 1
    cp -a -- "$MIR_ROOT/desktop/src-tauri/"{src,icons,capabilities} "$stage/desktop/src-tauri/" || exit 1
    printf 'Preparing Mir.cpp desktop. The first compilation can take several minutes...\n' >&2
    # shellcheck disable=SC2016 # Arguments are expanded inside the compiler worker.
    platform_start_worker "$BASH" -euo pipefail -c 'MIR_ROOT=$1; PLATFORM_ID=$4; source "$1/lib/platform.sh"; load_platform "$4"; source "$1/lib/bootstrap.sh"; desktop_compile "$2" "$3"' \
        mir-desktop-build "$MIR_ROOT" "$stage" "$cache/target" "$PLATFORM_ID" >&2 &
    worker=$!
    while kill -0 "$worker" 2>/dev/null; do
        if worker_identity=$(ps -p "$worker" -o lstart= 2>/dev/null) &&
            [[ $(ps -p "$worker" -o pgid= 2>/dev/null | tr -d ' ') == "$worker" ]]; then break; fi
    done
    trap 'exit 130' INT
    trap 'exit 143' TERM HUP
    (( interrupted == 0 )) || exit "$interrupted"
    wait "$worker" || exit 1
    worker=''
    mkdir -p -- "$cache/$identity" || exit 1
    if [[ "$artifact" == Mir.cpp.app ]]; then
        cp -R -- "$cache/target/release/bundle/macos/$artifact" "$stage/$artifact" || exit 1
        # A failed self-check may have left an unusable bundle for this identity.
        rm -rf -- "${cache:?}/${identity:?}/Mir.cpp.app" || exit 1
        replace_path "$stage/$artifact" "$cache/$identity/$artifact" || exit 1
    else
        cp -- "$cache/target/release/mir-desktop" "$stage/mir-desktop" || exit 1
        chmod +x "$stage/mir-desktop" || exit 1
        mv -f -- "$stage/mir-desktop" "$binary" || exit 1
    fi
    stop_preparation
    trap - EXIT INT TERM HUP
    platform_lock unlock 8
    exec 8>&-
    GUI_BINARY=$binary
}
