# Desktop development

Mir.cpp is written for human maintainers. Frontend modules separate app composition,
chat, settings, server controls, llama.cpp maintenance, shared controls and native
transport. Rust modules separate the bridge, server, diagnostics, chat, builds and history.

Normal source startup is `bash mir/mir.sh`; desktop preparation is automatic.
Developer tools are Bash 4.4+, Python 3, compatible Node/npm and Rust 1.92+ with
rustfmt and Clippy. Native window builds also require the platform's
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

From the repository root, run `bash mir/tests/run.sh` for the complete automated
suite, including the native window when a graphical session is available, or select `common`, `linux`, `macos`, `desktop` or `native`. The runner
prepares npm dependencies and browser downloads when needed. Tests use isolated
directories, fake executables and a local HTTP server; no GPU, models or working
llama.cpp installation are needed. Linux native-window tests use a private D-Bus
session, Xvfb and software rendering, as configured in the CI workflow.

From this directory, `npm run dev` opens the frontend development server.
Append `?scenario=empty`, `cpu`, `multiple`, `unknown-memory`, `occupied`,
`save-error`, `model-error`, `interrupted` or `cancel` to exercise simulated services.
Error scenarios also include `oom`, `oom-startup`, `oom-and-save-error`,
`compute-error`, `history-error` and `build-error`. Contract scenarios also include
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
Error fixtures follow the pinned upstream [HTTP/SSE contract](https://github.com/ggml-org/llama.cpp/blob/a4d4f2fd4ec85ec6a0a9ece4870416c1b6cc24f5/tools/server/README.md#api-errors)
and [fatal Metal backend diagnostic](https://github.com/ggml-org/llama.cpp/blob/a4d4f2fd4ec85ec6a0a9ece4870416c1b6cc24f5/ggml/src/ggml-metal/ggml-metal-context.m).
Review those contracts when updating the fixtures; other diagnostics remain
generic unless the server provides enough evidence to classify them.

With `npm run dev` running in a separate terminal, run
`node tests/design-review.mjs final` from this directory to capture all 26 approved
screens at 1200×820 and 960×720 in Chromium and WebKit. The generated
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
Read the [template capabilities](https://github.com/ggml-org/llama.cpp/blob/a4d4f2fd4ec85ec6a0a9ece4870416c1b6cc24f5/common/jinja/caps.cpp)
and [stream serialization](https://github.com/ggml-org/llama.cpp/blob/a4d4f2fd4ec85ec6a0a9ece4870416c1b6cc24f5/tools/server/server-task.cpp)
when updating those fixtures.

Keep runtime-files.txt aligned with bundled sources and regenerate the standalone
installer after moving runtime files. Do not include generated output, tests,
node_modules or target in the runtime manifest.

See the [guide](../docs/guide.md#development-on-one-computer) for architecture,
settings, contracts, preparation, data paths and release maintenance.

R005 file and context checks use generated tiny Office ZIP packages, temporary
storage, native file IPC and local `/tokenize` responses. The tokenization fixture
follows the pinned [server tokenization and template contract](https://github.com/ggml-org/llama.cpp/blob/a4d4f2fd4ec85ec6a0a9ece4870416c1b6cc24f5/tools/server/README.md#post-tokenize-tokenize-a-given-text).
The dialog implementation follows the [Tauri 2 dialog API](https://v2.tauri.app/plugin/dialog/).
Browser drag fixtures use the native enter/over/drop/leave payload shape, rather
than HTML5 drop events. The native smoke test exercises actual storage, download,
export/import commands and attachment/menu rendering; OS file-dialog interaction
still requires a manual check on each target platform.

Keyboard traversal tests use Option-Tab in macOS WebKit, matching the platform's
control traversal behavior without changing user preferences. See the
[Apple keyboard shortcut guidance](https://support.apple.com/en-lamr/guide/safari/cpsh003/mac)
and [Playwright's platform behavior discussion](https://github.com/microsoft/playwright/issues/41808).

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
