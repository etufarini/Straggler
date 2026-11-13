# Desktop development

Mir.cpp is written for human maintainers. Frontend modules separate app composition,
chat, settings, server controls, llama.cpp maintenance, shared controls and native
transport. Rust modules separate native configuration/persistence, OS services, server supervision,
diagnostics, chat and history. The private shell bridge has been removed; the desktop uses native services.

Normal source startup is `bash mir/mir.sh`; desktop preparation is automatic.
Developer tools are Bash 4.4+, Python 3, compatible Node/npm and Rust 1.92+ with
rustfmt and Clippy. Native window builds also require the platform's
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

From the repository root, run `bash mir/tests/run.sh` for the complete automated
suite, including the native window when a graphical session is available, or select `common`, `linux`, `macos`, `desktop`, `native` or `packaging`. The runner
prepares npm dependencies and browser downloads when needed. Tests use isolated
directories, fake executables and a local HTTP server; no GPU, models or working
llama.cpp installation are needed. Linux native-window tests use a private D-Bus
session, Xvfb and software rendering, as configured in the CI workflow.

From this directory, `npm run dev` opens the frontend development server.
Append `?scenario=empty`, `cpu`, `multiple`, `unknown-memory`, `occupied`,
`save-error`, `model-error`, `interrupted` or `cancel` to exercise simulated services.
Error scenarios also include `oom`, `oom-startup`, `oom-and-save-error`,
`compute-error`, `history-error` and `backend-error`. Contract scenarios also include
`no-metrics`, `no-reasoning`, `effort-levels`, `context-high`, `context-full` and
`reasoning-stream`.
The banner identifies simulation; production builds exclude fixture transport.
A plain browser preview reports unavailable native services.

Use `npm run desktop` for native development, `npm run format` for formatting,
and `npm run test:native` for the actual window with a test server. Native tests
use a debug-only embedded WebDriver plugin on both Linux and macOS. Production
builds reject the native-tests feature. No inspector-specific client is needed.
The native test includes fatal memory failure while `/health` remains successful,
partial-response persistence, explicit Stop and a clean server restart.
Error fixtures follow the pinned upstream [HTTP/SSE contract](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/tools/server/README.md#api-errors)
and [fatal Metal backend diagnostic](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/ggml/src/ggml-metal/ggml-metal-context.m).
Review those contracts when updating the fixtures; other diagnostics remain
generic unless the server provides enough evidence to classify them.

With `npm run dev` running in a separate terminal, run
`node tests/design-review.mjs final` from this directory to capture the legacy review
screens and all R001 screens at 1200×820 and 960×720 in Chromium and WebKit. The generated
`test-results/design/final/comparison.html` pairs actual React fixture views with
proposal templates, and checks console errors and the visible 11px type floor.
Fixtures are labeled simulation; they are not evidence of model inference.

On Linux, `MIR_MEASURE_ORB=1 bash mir/tests/run.sh native` from the repository root
also samples a real native window during a local fixture stream, then hides that
window and measures again. Set `LIBGL_ALWAYS_SOFTWARE=1` and
`WEBKIT_DISABLE_COMPOSITING_MODE=1` for a CPU-only rendering run. The resulting
`test-results/native-orb-cpu.json` reports the GUI process tree's CPU percentage
(100% is one core), actual frame rate and native/DOM visibility. This includes
GUI, polling and fixture overhead; it does not measure inference. The hidden
sample must render zero frames. Window hiding is supplied by a native-tests-only
command, absent from production. Minimize requests can be ignored by runner window
managers and are not treated as proof of a hidden window.

The test server and Rust checks also pin model properties, template rendering,
per-request reasoning and final usage-only SSE chunks to the same upstream commit.
Read the [template capabilities](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/common/jinja/caps.cpp)
and [stream serialization](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/tools/server/server-task.cpp)
when updating those fixtures.

Keep runtime-files.txt (shared sources) and runtime-files.linux.txt/runtime-files.macos.txt
(platform sources and configuration) aligned with bundled sources and regenerate the standalone
installer after moving runtime files. Do not include generated output, tests,
node_modules or target in the runtime manifest.

The `packaging` suite checks pinned-backend preparation and native process lifecycle
with temporary directories, tiny Mach-O/ELF fixtures and a fake HTTP server. It does
not download llama.cpp or require a Mac, model, GPU or inference service. Those
tests also run through the regular common/desktop suites.

The optional macOS sandbox diagnostic uses the same Tauri executable compiled
with `packaging-probe`. It uses native services and creates no chat window.
It checks an upstream backend included in the bundle, writes an isolated native
report and optionally opens a GGUF through the native picker for a CPU loading
check. This diagnostic mode is separate from the normal desktop startup path. Add
`--desktop` to the macOS packaging command to build the regular GUI with the same
pinned backend for direct distribution; that mode uses the normal identifier and
does not enable App Sandbox. The separate `--app-store` variant uses native
model-folder selection, persistent
security-scoped bookmarks, container storage and the bundled backend only.
`--store-check --debug` selects an isolated test app/container with native WebDriver
checks. Certificate/profile and signed `.pkg` preparation are supported without
uploading.

Ubuntu 24.04+ packages use
`python3 packaging/ubuntu.py bundle --target aarch64-unknown-linux-gnu`
(or `x86_64-unknown-linux-gnu`) on the matching Linux
architecture. The `.deb` installs `mir`, the pinned CPU backend and its private
libraries. The packager verifies the actual extracted payload and dynamic loaders.
See [the packaging procedure](../docs/guide.md#macos-backend-packaging-experiment)
for build, signing, manual checks and current limitations.

See the [guide](../docs/guide.md#development-on-one-computer) for architecture,
settings, contracts, preparation, data paths and release maintenance.

R005 file and context checks use generated tiny Office ZIP packages, temporary
storage, native file IPC and local `/tokenize` responses. The tokenization fixture
follows the pinned [server tokenization and template contract](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/tools/server/README.md#post-tokenize-tokenize-a-given-text).
The dialog implementation follows the [Tauri 2 dialog API](https://v2.tauri.app/plugin/dialog/).
Browser drag fixtures use the native enter/over/drop/leave payload shape, rather
than HTML5 drop events. The native smoke test exercises actual storage, download,
export/import commands and attachment/menu rendering; OS file-dialog interaction
still requires a manual check on each target platform.

Keyboard traversal tests use Option-Tab in macOS WebKit, matching the platform's
control traversal behavior without changing user preferences. See the
[Apple keyboard shortcut guidance](https://support.apple.com/en-lamr/guide/safari/cpsh003/mac)
and [Playwright's platform behavior discussion](https://github.com/microsoft/playwright/issues/41808).

## Projects development checks

Projects reuse native attachment extraction and history serialization. The shared
`src/domain/projectContext.ts` owns request assembly, a 25% conversation reserve,
the 75%/over-100% project thresholds and the four-characters-per-token fallback.
The regular chat context counter retains its existing policy. All IPC remains in
`src/services/desktop.ts`; project data stays in the native XDG desktop data root.

Project tests cover legacy history without rewrites, atomic storage/recovery,
own-prompt restoration, request snapshots during generation, current-prompt
exports, archived read-only behavior and unknown-capacity server rejections.
The over-context fixture follows the pinned server's
[input check](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/tools/server/server-context.cpp#L3748-L3766),
[first-error response](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/tools/server/server-context.cpp#L4974-L4986)
and [error serialization](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/tools/server/server-task.cpp#L1453-L1459).
It returns HTTP 400 JSON with `exceed_context_size_error` before SSE output,
including when the client requested streaming; it never simulates input truncation.

With `npm run dev` running, `node tests/design-review.mjs r001` captures every R001
React screen and its actual dossier Proposal rendering in Chromium and WebKit at
1200×820, 760×560, 960×720 and 1440×900. Output is under `test-results/design/r001/`.
The fixtures are explicitly simulated. The fixture helper reads only requested
proposal template ranges; references use the dossier viewer without changing its evidence.
Run `node tests/r001-reference.mjs` for reference-only captures.

## Dependency maintenance

Use Node 22.13+, 24 or 26+, matching `package.json` and automatic preparation.
Node 22.12 does not satisfy ESLint 10's requirements. Keep `@types/node` on
the Node 24 line used by CI and the private fallback toolchain.

After dependency updates, run `npm ci`, `npm audit`, `npm outdated`, `npm ls --all`
and `bash mir/tests/run.sh` from the repository root (npm commands run in this
directory). Every direct dependency is used by the application, configuration,
development commands or tests. Keep transitive versions within their parents'
declared ranges; a newer major is not itself an installation error.

`allowScripts` records reviewed, version-pinned install scripts: esbuild prepares
and validates its platform binary; optional macOS fsevents builds its native
binding with node-gyp. Review changed scripts before updating these approvals.
This uses npm's [install-script approval](https://docs.npmjs.com/cli/v11/commands/npm-approve-scripts/)
mechanism without disabling scripts or warnings.

On 2026-11-12, the full audit still reports 10 moderate dependency entries from
one advisory, [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
ESLint 10.14.0, its config-array dependency and TypeScript ESLint 8.72.2 require
minimatch 10.x; the fix starts at 11.0.1. There is no patched 10.x release.
The affected packages are development dependencies; `npm audit --omit=dev`
reports no vulnerabilities. The inspected lint paths use the default
`optimizationLevel: 1`, while this advisory requires level 2 or higher. That
limits the current exposure but does not resolve the dependency advisory.

Do not force a minimatch 11 override: its matching behavior and public APIs have
[breaking changes](https://github.com/isaacs/minimatch/blob/v11.0.8/changelog.md).
The audit's suggested downgrade to TypeScript ESLint 8.36 also conflicts with
ESLint 10 and TypeScript 5.9. Recheck the advisory and parent releases before
updating. Vite 8, plugin-react 6, Lucide 1 and TypeScript 7 are deferred major
migrations; TypeScript 7 is outside TypeScript ESLint's supported peer range.

Native configuration defaults live in `src-tauri/src/configuration/defaults.json`;
development fixtures import that record and contract tests compare it with the
compatibility launcher. Runtime tests supply an explicit captured environment,
so no test changes process-global HOME or uses personal settings. Native discovery
uses bounded subprocesses for the selected backend's advertised help/devices and
reads GGUF metadata with the same bounded fallback as the compatibility launcher.
Linux process attribution uses procfs and pidfd signaling; macOS uses libproc.
The additional libproc/bindgen dependency is macOS build tooling; the application
does not execute Xcode, Homebrew or system inspection utilities.

The native smoke test copies a normal development executable away from the source
tree and rejects desktop invocations of Bash, Python helpers, curl and OS command
utilities. Python remains available solely to the test's fake server. Explicit
`MIR_TEST_NATIVE` bundles retain their directory layout for dynamic libraries.
