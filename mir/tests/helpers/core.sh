#!/usr/bin/env bash
# Explicit imports prevent adapters from overwriting each other's functions.
load_test_core() {
    if [[ "$1" == fake ]]; then
        source "$MIR_ROOT/tests/helpers/fake.sh"
        PLATFORM_LOADED=fake
    else
        source "$MIR_ROOT/lib/platform.sh"
        load_platform "$1"
    fi
    source "$MIR_ROOT/lib/launcher.sh"
    load_launcher_modules
}

# Call explicitly after loading modules; never inherit personal launcher settings.
setup_test_workspace() {
    local root=$MIR_ROOT variable tool executable
    for variable in ${!MIR_@} ${!LLAMA_@} ${!XDG_@}; do unset "$variable"; done
    MIR_ROOT=$root
    work=$(mktemp -d)
    trap 'command rm -rf -- "$work"' EXIT
    export HOME="$work/home" XDG_CONFIG_HOME="$work/config" XDG_DATA_HOME="$work/data"
    mkdir -p "$HOME" "$work/bin"
    for tool in find mv; do
        executable=$(command -v "g$tool" || command -v "$tool")
        ln -s "$executable" "$work/bin/$tool"
    done
    export PATH="$work/bin:$PATH"
    cd -- "$work" || return 1
}
