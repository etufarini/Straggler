# Desktop development

Use this page for development commands and fixture contracts. The
[user and developer guide](../docs/guide.md) covers app behavior, configuration,
architecture, storage and packaging.

Straggler is written for human maintainers. Keep configuration, native OS services,
process supervision, streaming and storage in focused Rust modules. Keep React
features, domain logic and the typed desktop service separate; all IPC belongs in
`src/services/desktop.ts`.

## Setup and commands

Install the [development prerequisites](../docs/guide.md#local-development) for
your platform, then run from the repository root:

```bash
npm --prefix straggler/desktop ci
npm --prefix straggler/desktop run desktop
```

The second command opens the native Tauri window. Source sessions can select an
existing external llama.cpp build in Settings; opening the app and running the
required checks need no GPU, model weights or inference service.

Run the commands in this table from `straggler/desktop`. Prefer the
[test runner](#test-suites) for complete checks; direct npm commands are useful
for a specific task.

| Command | Purpose |
| --- | --- |
| `npm run desktop` | Start Vite and the native development window |
| `npm run dev` | Serve the browser preview on 127.0.0.1:1420 |
| `npm run build` | Check TypeScript and build production frontend assets |
| `npm run format` | Format frontend and JavaScript test/configuration files |
| `npm run format:check` | Check formatting without writing files |
| `npm run lint` | Check frontend and TypeScript tests with ESLint |
| `npm run typecheck` | Check TypeScript without building assets |
| `npm test` | Run frontend/domain unit tests |
| `npm run test:runtime` | Run Rust unit/integration tests without the desktop feature |
| `npm run test:e2e` | Run Chromium and WebKit flows |
| `npm run test:native` | Build and exercise the actual Tauri window with a fake backend |

## Test suites

The development entry point is `bash straggler/tests/run.sh`, run from the
repository root. Add a suite name to focus the checks:

```bash
bash straggler/tests/run.sh frontend
```

| Suite | Checks | Required setup |
| --- | --- | --- |
| `all` (default) | Common, frontend, runtime, browser and native checks | Combined prerequisites below; native checks may be skipped on headless Linux |
| `common` | Runner boundaries, Bash syntax/ShellCheck and offline archive fixtures | Bash 3.2+, Python; ShellCheck is optional locally |
| `frontend` | Formatting, lint, types, production assets and unit contracts | Node/npm and `npm ci` |
| `runtime` | Rust formatting, Clippy, runtime tests and macOS Store boundaries | Rust with rustfmt/Clippy, Python and the host linker; no npm or native GUI libraries |
| `browser` | WebKit flows on the host platform | Node/npm, `npm ci`, Playwright WebKit and its system dependencies |
| `desktop` | Frontend, runtime and browser suites | Combined prerequisites for those three suites |
| `isolation` | Compile the native desktop with only shared and host-platform inputs | Rust, Python and the host Tauri development dependencies |
| `native` | Isolation, desktop Clippy and the actual native window | Native app setup, Python and a display or headless Linux tools |
| `packaging` | Offline archive fixtures and native resource/backend boundaries; Store boundaries on macOS | Rust, Python and the host linker; no model or backend download |

Install browser engines explicitly from `straggler/desktop` before browser checks:

```bash
npm exec -- playwright install webkit
```

On Linux, Playwright may also need system dependencies. The runner does not
install system packages. See the guide for
[headless Linux behavior and CI coverage](../docs/guide.md#run-the-checks).
Windows is not a supported native target.

## Test boundaries

Tests use temporary user directories, tiny generated documents, fake executables
and local HTTP/SSE fixtures. Native defaults in
`src-tauri/src/configuration/defaults.json` are shared with frontend fixtures.
Rust checks cover legacy profiles and migration, literal serialization, process
identity, cancellation, storage recovery and streaming.
The runtime suite runs Rust tests serially to isolate native socket probes and
process fixtures. Tests of concurrent operations still run their own workers.

The native test copies the GUI away from the source tree and rejects Bash,
Python-helper, curl and OS utility invocations by the app. Python is permitted
only for the fake backend and the loopback Hub development fixture. The test
exercises the actual window, IPC, fatal error recovery, partial response persistence, confirmed Stop/restart and shutdown
cleanup. It also checks temporary chat disposal and a synthetic Hub download
through real IPC, native filesystem writes and SHA-256 verification; the keychain
provider is replaced by an in-memory store. WebDriver is enabled only by
`native-tests` in debug builds; production compilation rejects it.

Browser WebKit on Linux provides renderer coverage. Native macOS WebView, process
and package behavior still require a macOS runner. Offline packaging tests use
tiny Mach-O and ELF fixtures. Optional real package checks use the pinned upstream
backend without models. The package-window harness substitutes a debug GUI only
when WebDriver is needed; packaged backend libraries and resource paths stay in use.

Project requests take immutable snapshots of current instructions and selected
files. `src/domain/projectContext.ts` owns the 25% reply reserve, 75% warning and
four-characters-per-token fallback. Tests cover unknown capacity without fabricated
limits, own-prompt restoration, archive guards, atomic recovery and current-prompt
exports. Attachment checks use native extraction and generated document fixtures.

## Browser fixtures

With Vite running, open a URL such as
`http://127.0.0.1:1420/?scenario=empty`. Every scenario is labelled as a simulation;
fixture services are excluded from production transport.

| Area | Scenario values |
| --- | --- |
| Setup and devices | `normal`, `empty`, `cpu`, `multiple`, `unknown-memory`, `occupied` |
| Storage and backend errors | `save-error`, `history-error`, `model-error`, `backend-error` |
| Generation and recovery | `interrupted`, `cancel`, `oom`, `oom-startup`, `oom-and-save-error`, `compute-error` |
| Reasoning and context | `no-metrics`, `no-reasoning`, `effort-levels`, `context-high`, `context-full`, `reasoning-stream` |

## Upstream fixture contracts

The backend pin is `packaging/llama-runtime.json`. Review these contracts when
changing the pin or fake server; keep fixtures aligned with native services:

- [HTTP errors, tokenization and chat API](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/tools/server/README.md)
- [Template capabilities](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/common/jinja/caps.cpp)
- [Stream serialization](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/tools/server/server-task.cpp)
- [Context limits and request rejection](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/tools/server/server-context.cpp)
- [Fatal Metal diagnostic](https://github.com/ggml-org/llama.cpp/blob/3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8/ggml/src/ggml-metal/ggml-metal-context.m)
- [Select-only combobox keyboard contract](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/)
- [Hub repository API and tree/LFS metadata](https://huggingface.co/docs/hub/api)
- [FileChooser portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.FileChooser.html)
- [Tauri native dialogs](https://v2.tauri.app/plugin/dialog/)

Temporary backend fixtures advertise `--slots`, `--cache-ram` and `--log-disable`,
provide an idle slot with an arbitrary ID, and implement slot erase. Review the
pinned server context/slot code when changing privacy flags: `cache_prompt: false`
alone does not disable global RAM cache. Tests need no model or real inference.

`src-tauri/src/huggingface/tests.rs` and `tests/fixtures/huggingface.py` serve Hub-shaped
search, immutable repository/tree metadata with LFS SHA-256, Range responses and
synthetic file bytes on loopback. Tests cover interruption, ignored/invalid Range,
checksum mismatch, parts, cancellation, storage errors and explicit resume after
restart. `STRAGGLER_TEST_HF_ENDPOINT` exists only in debug `native-tests` builds,
accepts IPv4 loopback HTTP and uses a memory token store. It is absent in production.
The browser Hub fixture uses explicit test controls documented by
`tests/e2e/hugging-face.spec.ts`, including gated access and low-disk/interruption
flags; these are development controls, not production preferences.
Live OS keychain, Flatpak portal grants and signed macOS Store bookmark/child access
remain platform integration checks; mocks do not establish those permissions.

## Optional visual diagnostics

Run these commands from `straggler/desktop` with Vite running:

| Command | Output |
| --- | --- |
| `node tests/design-review.mjs final` | Browser fixture captures under `test-results/design/` |
| `node tests/design-review.mjs r001` | Captures including project scenarios; reference views need the separately supplied design dossier |

For real first-use native screenshots, set `STRAGGLER_CAPTURE_DOCS` to a new
version directory when running the native suite, for example:

```bash
STRAGGLER_CAPTURE_DOCS=d009 bash straggler/tests/run.sh native
```

Run that command from the repository root. It creates
`straggler/docs/screenshots/d009/` exclusively and refuses to overwrite an existing
version. It opens the real app without a configured backend or model, captures
chat and settings, then closes the window. Keep the original dossier baseline
immutable; append evidence in a new dossier revision without using its builder.

Browser captures document simulated UI states, not inference results. From the
repository root on Linux or macOS, run the optional animation measurement with:

```bash
STRAGGLER_MEASURE_ORB=1 bash straggler/tests/run.sh native
```

It records draw callback intervals through loading, reasoning and a longer
Markdown response, then samples visible and hidden animation. Linux also measures
CPU usage for the owned GUI process tree; macOS reports that CPU check as skipped.
The hidden sample must render zero frames. These are callback measurements, not
proof that each frame reached the display, and include GUI and fixture overhead
rather than inference performance. Results are in `test-results/native-orb-cpu.json`.
For a controlled desktop benchmark, set `STRAGGLER_ORB_MAX_FRAME_P95_MS` to a
positive interval limit in milliseconds. This optional limit is not a hardware
requirement for the standard suite. Browser streaming checks also attach
`orb-performance.json` with draw costs and detail levels.

## Dependency maintenance

Use `npm ci` for reproducible setup. After dependency updates, run these commands
from `straggler/desktop`, then run the full test runner from the repository root:

```bash
npm audit
npm outdated
npm ls --all
```

Review changed install scripts before updating version-pinned `allowScripts`
entries. Keep lockfile packages for other platforms so Linux/macOS installs remain
portable. Optional packages for other platforms or unused integrations reported
by `npm ls --all` do not all need to be installed.

The current development toolchain scopes temporary overrides to
`eslint@^10.14.0`, `@eslint/config-array@0.23.5` and
`@typescript-eslint/typescript-estree@8.72.2`, selecting `minimatch@11.0.8` for the
[glob-pattern resource-exhaustion fix](https://github.com/advisories/GHSA-g3hv-75wg-m249).
These overrides are compatibility exceptions to the parents' minimatch 10 ranges.
Review the actual callers, file selection and diagnostics when updating them:
Minimatch 11 changes APIs and matching behavior. Revalidate each override when its
parent changes and remove it once the parent supports a patched release. Do not
suppress audit output or apply audit-suggested ESLint/TypeScript ESLint downgrades.

Review major upgrades against the build pipeline, icon changes and TypeScript
ESLint's supported TypeScript range. Node types follow the Node 24 CI environment.

## Packaging commands

Use the [packaging guide](../docs/guide.md#building-packages) for native GUI packages
with the pinned backend, signing and release candidates. Plain `npm run bundle`
builds the Tauri app without preparing that backend. Python, Node and Rust are
build/test dependencies only. Local candidate builds do not publish releases or
submit to an app store.

## Branding assets

The Straggler mark uses two overlapping stars with a cyan center. The sidebar
and assistant message avatars share `src/assets/brand-mark.svg`. Native icon sources
are `src-tauri/icons/icon.svg` and `icon-small.svg`; both use the same symbol.
The small source uses a 24 px symbol
inside a 32 px frame, matching the supplied artwork. The README reuses the native
icon.

To regenerate the checked-in PNGs from this directory:

```bash
npm exec -- tauri icon src-tauri/icons/icon.svg --output packaging/generated/icons
npm exec -- tauri icon src-tauri/icons/icon-small.svg --output packaging/generated/icons-small --png 32
cp packaging/generated/icons/icon.png packaging/generated/icons/128x128.png packaging/generated/icons/128x128@2x.png src-tauri/icons/
cp packaging/generated/icons-small/32x32.png src-tauri/icons/
```

macOS packaging generates the complete ICNS from `icon.svg`, including its
1024 px representation. The app loads bundled SVG/PNG assets without external
fonts, artwork scripts or network requests.
