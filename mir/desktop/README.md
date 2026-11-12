# Desktop development

Mir.cpp is written for human maintainers. Keep configuration, native OS services,
process supervision, streaming and storage in focused Rust modules. Keep React
features, domain logic and the typed desktop service separate; all IPC belongs in
`src/services/desktop.ts`.

## Setup and commands

Install Node.js 22.13+, 24 or 26+, Rust 1.92+ with rustfmt/Clippy, Python 3.9+ for
fixtures/packaging, and the platform's [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
From the repository root:

```bash
npm --prefix mir/desktop ci
npm --prefix mir/desktop run desktop
bash mir/tests/run.sh
```

The app uses Rust native services directly. Installed packages include the backend;
source development can select an existing external llama.cpp build. No toolchain
bootstrap or shell bridge is involved.

From this directory:

| Command | Purpose |
| --- | --- |
| `npm run desktop` | Vite plus the native development window |
| `npm run dev` | Browser preview on 127.0.0.1:1420 |
| `npm run build` | TypeScript check and production frontend |
| `npm run format` | Format frontend and JavaScript tests |
| `npm test` | Frontend/domain unit tests |
| `npm run test:runtime` | Rust unit/integration tests without the desktop feature |
| `npm run test:e2e` | Chromium and WebKit flows |
| `npm run test:native` | Actual Tauri window with a local fake backend |

Install browser engines with `npm exec -- playwright install chromium webkit`.
On Linux, browser installation may also require Playwright system dependencies.
The runner requires explicit dependency setup and supports `desktop`, `native`,
`packaging` and the default `all` suite. See the [guide](../docs/guide.md#local-development)
for headless Linux requirements. Native Windows is not a supported target.

## Test boundaries

Tests use temporary directories, tiny generated documents, fake executables and
local HTTP/SSE fixtures. No GPU, model weights or working llama.cpp installation is
required. Native defaults in `src-tauri/src/configuration/defaults.json` are shared
with frontend fixtures. Rust checks cover legacy profiles/migration, literal
serialization, process identity, cancellation, storage recovery and streaming.

The native test copies the GUI away from the source tree and rejects Bash,
Python-helper, curl and OS utility invocations. Python is permitted only for the
fake backend. It exercises the actual window, IPC, fatal error recovery, partial
response persistence, confirmed Stop/restart and shutdown cleanup. WebDriver is
enabled only by `native-tests` in debug builds; production compilation rejects it.

`packaging` tests inspect archive/library boundaries offline using tiny Mach-O and
ELF fixtures. Optional real package checks use the pinned upstream backend and no
models. The package-window harness substitutes a debug GUI only when WebDriver is
needed; real packaged backend libraries and resource paths remain in use.

Browser previews accept `?scenario=empty`, `cpu`, `multiple`, `unknown-memory`,
`occupied`, `save-error`, `model-error`, `interrupted`, `cancel`, `oom`,
`oom-startup`, `oom-and-save-error`, `compute-error`, `history-error` and
`backend-error`. Reasoning/context fixtures include `no-metrics`, `no-reasoning`,
`effort-levels`, `context-high`, `context-full` and `reasoning-stream`.
All scenarios are labelled simulations and excluded from production transport.

Project requests take immutable snapshots of current instructions and selected
files. `src/domain/projectContext.ts` owns the 25% reply reserve, 75% warning and
four-characters-per-token fallback. Tests cover unknown capacity without fabricated
limits, own-prompt restoration, archive guards, atomic recovery and current-prompt
exports. Attachment checks use native extraction and generated document fixtures.

## Upstream fixture contracts

The backend pin is `packaging/llama-runtime.json`. Review these contracts when
changing the pin or fake server; keep fixtures aligned with native services:

- [HTTP errors, tokenization and chat API](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/tools/server/README.md)
- [Template capabilities](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/common/jinja/caps.cpp)
- [Stream serialization](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/tools/server/server-task.cpp)
- [Context limits and request rejection](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/tools/server/server-context.cpp)
- [Fatal Metal diagnostic](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/ggml/src/ggml-metal/ggml-metal-context.m)
- [Tauri native dialogs](https://v2.tauri.app/plugin/dialog/)

## Optional visual diagnostics

With Vite running, `node tests/design-review.mjs final` captures browser fixture
views; `node tests/design-review.mjs r001` includes project scenarios. Reference
captures need the separately supplied design dossier. Generated output is under
`test-results/design/` and is not evidence of inference.

On Linux, `MIR_MEASURE_ORB=1 bash mir/tests/run.sh native` from the repository root
measures CPU/frame rate during fixture streaming and after hiding the native
window. The hidden sample must render zero frames. Results include GUI and fixture
overhead, not inference performance.

## Dependencies and packaging

Use `npm ci` for reproducible setup. After dependency updates, run `npm audit`,
`npm outdated`, `npm ls --all` and the full test runner. Review changed install
scripts before updating the version-pinned `allowScripts` entries.

The last recorded audit on 2026-11-12 reported 10 moderate development-dependency
entries for [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249),
with none in production dependencies. ESLint/TypeScript ESLint require minimatch
10; the fix begins at 11. Do not force an incompatible major override. Recheck the
advisory and parent releases before updating dependencies.

Use the [packaging guide](../docs/guide.md#building-packages) to produce GUI packages
with the pinned backend. Plain `npm run bundle` is a Tauri build and does not
prepare that backend. Python, Node and Rust are build/test dependencies only.
Local candidate builds do not publish releases or submit to an app store.
