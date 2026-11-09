# Desktop development

Mir.cpp is written for human maintainers. Frontend modules separate app composition,
chat, settings, server controls, llama.cpp maintenance, shared controls and native
transport. Rust modules separate the bridge, server, chat, builds and history.

Normal source startup is `bash mir/mir.sh`; desktop preparation is automatic.
Developer tools are Bash 4.4+, Python 3, compatible Node/npm and Rust 1.92+ with
rustfmt and Clippy. Native window builds also require the platform's
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

From the repository root, run `bash mir/tests/run.sh` for the complete automated
suite, including the native window when a graphical session is available, or select `common`, `linux`, `macos`, `desktop` or `native`. The runner
prepares npm dependencies and browser downloads when needed. Tests use isolated
directories, fake executables and a local HTTP server; no GPU, models or working
llama.cpp installation are needed. Linux native-window tests can use xvfb-run.

From this directory, `npm run dev` opens the frontend development server.
Append `?scenario=empty`, `cpu`, `multiple`, `unknown-memory`, `occupied`,
`save-error`, `model-error`, `interrupted` or `cancel` to exercise simulated services.
The banner identifies simulation; production builds exclude fixture transport.
A plain browser preview reports unavailable native services.

Use `npm run desktop` for native development, `npm run format` for formatting,
and `npm run test:native` for the actual window with a test server. Native tests
use a debug-only embedded WebDriver plugin on both Linux and macOS. Production
builds reject the native-tests feature. No inspector-specific client is needed.

Keep runtime-files.txt aligned with bundled sources and regenerate the standalone
installer after moving runtime files. Do not include generated output, tests,
node_modules or target in the runtime manifest.

See the [guide](../docs/guide.md#development-on-one-computer) for architecture,
settings, contracts, preparation, data paths and release maintenance.
