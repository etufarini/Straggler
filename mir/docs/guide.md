# Mir.cpp user and developer guide

Mir.cpp manages local chat, settings, conversations and a supervised llama.cpp
server. The native services are Rust; the interface is React/TypeScript rendered
by Tauri. llama.cpp supplies model support, inference and device allocation.

## Installation and updates

Desktop packages are not published yet. The development packaging tools produce
macOS application bundles/disk images and Ubuntu Debian packages, including a
pinned llama.cpp backend. The old v1.0.0 terminal release is a separate product
version; its installer does not install this desktop.

On macOS, drag Mir.cpp from the disk image to Applications and open it there.
On Ubuntu, install the `.deb` with your package manager and open Mir.cpp from the
application menu. Supported baselines are macOS 13.5+ and Ubuntu 24.04+, on the
architecture matching the package. A graphical session is required.

Installed startup does not compile code or download tools. Packages need no Bash,
Python, Node.js or Rust toolchain at runtime. Linux packages depend on system
libraries, including WebKitGTK and GTK. Model weights and GPU drivers are separate.

Close Mir.cpp before replacing its package. Application updates include backend
updates. The regular desktop can also use an external llama.cpp build through
**Settings → llama.cpp**. The App Store variant uses only its included backend.
Remove the app through the operating system; personal settings, conversations,
models and external backends are separate from the application payload.

## First launch and settings

Choose a models folder in **Settings → Folders**, then a GGUF in **Model settings**.
Subfolders are searched recursively. Empty folders are allowed. Folder navigation
does not save a path until **Use this folder** is accepted. Hidden folders can be
shown or entered by path.

| Section | Controls |
| --- | --- |
| Model settings | Model, context, K/V cache, sampling, seed, output length and chat defaults |
| Performance | Device, threads, GPU layers, prompt processing and advanced device settings |
| Server & port | Port, listener details and confirmed process shutdown |
| Saved configurations | Load for review, save, save as new and confirmed deletion |
| Folders | Models and external llama.cpp directories |
| llama.cpp | Bundled backend details and external build selection |

An external folder may contain `build/bin/llama-server` or `bin/llama-server`;
the source-build layout takes precedence. Stop the server before changing its
backend. Source development has no included backend unless explicitly prepared.

The model selector, server controls and logs remain available from chat. Apply
validates edited settings. Loading a saved configuration never launches a server.
**Modified** compares edited settings with the saved configuration; **Restart
required** compares launch settings with the running server. Chat defaults apply
without restarting. Draft chat defaults take effect after Apply or a successful
profile save. The server badge opens its log.

Sidebar and assistant-panel expansion are remembered as desktop preferences,
separately from profiles and browser preferences. The assistant animation reflects
response state; it does not indicate inference speed or hardware readiness.

## Model and performance controls

Context includes input and output. Auto lets llama.cpp choose, zero requests the
full model context, and a positive count is explicit. A supported model can still
exceed available memory or use a chat template unsupported by the backend.

K and V cache defaults are `q4_0`. Available formats come from the selected
server's help. Quantized V may require Flash Attention; model/backend restrictions
are reported by llama.cpp. Mir.cpp does not infer compatibility from filenames.

| Sampling preset | Temperature | Top-P | Top-K | Min-P |
| --- | --- | --- | --- | --- |
| Default | Native | Native | Native | Native |
| Focused | 0.6 | 0.95 | 20 | 0 |
| Exploratory | 1 | 0.95 | 20 | 0 |
| Min-P | 1 | 1 | 0 | 0.05 |

Explicit presets use repeat penalty 1 and presence/frequency penalties 0. Applying
a preset preserves seed, output length, context, cache and performance settings.
Seed accepts Auto, -1 or an unsigned 32-bit integer. Output length accepts Auto,
-1 for no fixed limit, zero for input evaluation only or a positive token count.
A fixed seed does not promise identical output across devices.

Device names come from `llama-server --list-devices`. Auto lets llama.cpp choose;
CPU only uses `--device none --gpu-layers 0`. Explicit device order remains
supported. Auto threads and GPU layers omit overrides.

| Prompt processing | Batch size | Microbatch size |
| --- | --- | --- |
| Default | Native | Native |
| Low memory | 512 | 128 |
| Large batch | 2048 | 1024 |

Larger batches use more memory and do not guarantee better performance. Multiple
usable devices expose supported split modes, ordered devices, relative proportions
and fitting margins in MiB. Tensor mode is experimental. Margins are fitting
targets, not allocation limits. CPU-only startup omits GPU distribution settings.

Memory measurements are optional and approximate. Missing measurements never
block server controls or imply zero capacity. Mir.cpp does not certify that a
model fits. GPU support depends on the selected backend and installed drivers.
The bundled Ubuntu backend is CPU-only; an external GPU-enabled build can be used.

## Chat, reasoning and files

The composer's system prompt and reasoning controls apply from the next message.
A chat inherits applied defaults or keeps its own prompt; an explicitly empty
prompt sends no system message. Reasoning and effort controls depend on the
running template's advertised capabilities. Unsupported selections are reported
explicitly. Separate reasoning is displayed only when returned by the server.

User messages support Copy, Edit and Regenerate. Editing or regenerating an earlier
turn removes later turns, with an explanation before saving. Assistant responses
can be edited as Markdown; reasoning stays read-only. Stop response preserves
partial text. Failed saves preserve the editor and the previously saved response.

The conversation menu exports UTF-8 `mir.cpp/conversation` version 1 JSON, with
optional reasoning. Exports contain the effective system prompt at export time;
attachments, statistics and other request options are excluded. Import accepts
that format or a plain `{role, content}` message array, with `reasoning` accepted
as an alias for `reasoning_content`. It always creates a new conversation and
never merges or replaces history. Invalid files leave stored history unchanged.

Add files through the native chooser or window drag-and-drop. Supported formats
are UTF-8 `.txt` and `.md`, `.docx`, `.xlsx`, `.pptx` and `.pdf`, up to 10 MiB each
(shown as 10 MB). Legacy Office, CSV and OpenDocument are unsupported. Extraction
uses document text, declared slide order, spreadsheet sheets and PDF page order;
images, formatting and uncached formula results are excluded. PDFs need extractable
text and must be unlocked. Mir.cpp performs no OCR.

Conversation attachments enter every request in insertion order, labelled with
their filenames. Original copies and extracted text are retained in desktop
storage. Download works after the source has moved; Remove deletes the stored copy
and text. Deleting a conversation removes its attachments. Original source files
are untouched. Failed reads stay visible for removal without becoming saved files.

The context counter uses the running server's `n_ctx`, not a draft setting or the
model's training context. With attachments, it estimates the current prompt and
draft using the backend's tokenizer/template where available. An approximate
fallback is marked clearly. Send is blocked when the prompt exceeds known capacity,
and preflight checks the assembled request. Unknown capacity permits sending;
the backend can still reject it. Mir.cpp never silently truncates content.

## Projects

Use **Projects → New** or **All projects → New project** to group chats. Names are
required, unique ignoring case and limited to 80 characters; descriptions allow
200. Stars pin projects in the sidebar. All projects supports search, sorting and
Active/Archived tabs. Sidebar New chat starts outside projects.

Project instructions replace member chats' system prompts. Empty instructions fall
back to applied Settings defaults. The prompt chip edits shared project
instructions. A chat's own prompt is preserved and restored when it leaves the
project; moving a chat explains any prompt change before confirmation.

Project files use the same formats and size limit as attachments. Mir.cpp keeps
extracted text and includes selected files in full after the instructions, in
stable order. Include switches exclude a file without removing it. There is no
retrieval index or automatic selection of file excerpts.

The project meter reserves 25% of context for conversation and replies. It warns
at 75% of the remaining space and blocks new chats/sending above 100%. Tokenizer
counts are preferred; `≈` marks a four-characters-per-token fallback. Unknown
capacity remains explicitly unavailable and permits sending. Review files or
apply a larger supported context and restart; content is never dropped to fit.

Edits during generation apply to the next request; the current request keeps its
snapshot. Moving/removing the generating chat or archiving/deleting its project
waits until generation finishes or stops. Other chats remain manageable.

Archived projects are read-only until restored. Deletion confirms whether to
delete chats too; by default chats remain outside the project with their own
prompts restored. Move/remove, file removal, archive and restore offer brief Undo.
Confirmed project deletion is permanent. Exports include the current effective
prompt but omit project files and metadata. Imports create outside-project chats.

## Ports, shutdown and recovery

Desktop servers listen on loopback without opening a browser. Occupied ports block
startup even when the listener cannot be identified. Server & port shows available
process details. Stopping an unrelated listener requires confirmation and an
identity recheck. Force stop has a separate confirmation after normal shutdown was
attempted. Mir.cpp never elevates process-control permissions.

Closing the app confirms cancellation, saving and shutdown of its own server.
Interrupted and stopped responses retain partial text. Request errors stay with
the response; Technical details preserves the original diagnostic.

Storage failures stay beside the composer. Retry saving writes the current
conversation; Retry loading reloads unavailable history. New chat and conversation
switching wait while text is unsaved. Settings, logs and server controls remain
accessible. Keep the window open until saving succeeds.

An explicit fatal backend failure sets **Needs restart**. Confirmed memory
exhaustion shows **Not enough memory**. Stop the server, review context, choose
Low memory prompt processing or a smaller model, and restart. Settings are never
changed automatically. A healthy HTTP endpoint does not clear a fatal failure;
a new server run does. Generic compute errors are not labelled OOM without memory
evidence, and recoverable allocation warnings alone do not block chat.

## Data and compatibility

| Data | Location |
| --- | --- |
| Saved folders | `${XDG_CONFIG_HOME:-$HOME/.config}/mir.cpp/paths.conf` |
| Saved configurations | `${XDG_CONFIG_HOME:-$HOME/.config}/mir.cpp/profiles/*.conf` |
| Conversations, projects, preferences and session lock | `${XDG_DATA_HOME:-$HOME/.local/share}/mir.cpp/desktop/` |

Conversation originals live under `conversations/<UUID>/attachments/`. Project
records live under `projects/<UUID>/project.json`, with extracted text in
`files/<UUID>.txt`. Identifiers are validated, writes are atomic and saves are
serialized. Browser conversations/preferences and model files are untouched.

Profiles are literal `key=value` data. Only model is required on load. Missing
fields use independent defaults: port 9931, `q4_0` caches, an empty prompt and Auto
for other controls. Unknown/removed keys are ignored; invalid recognized fields,
duplicates or malformed lines reject the entire load. Loading does not rewrite
older profiles. Saving writes current fields; prompts are JSON-encoded on one
line to preserve multiline Unicode text without executing it.

Profile names start with an alphanumeric character and accept letters, digits,
spaces, dots, underscores and hyphens, up to 80 characters. Overwrite/deletion
require confirmation. Failed writes preserve files and saved association. Old
`llama-launcher` settings migrate atomically only when Mir.cpp configuration is
absent; originals are preserved. Previous shell installations are not upgraded
automatically. Back up shared settings and data before removing an old installation.

Environment controls initialize a session; explicitly set `MIR_*` values take
precedence over legacy aliases, including empty values. Invalid values are
reported rather than replaced. Supervised servers remain on loopback.

| Control | Legacy fallback / default |
| --- | --- |
| `MIR_LLAMA_CPP_DIR` | `LLAMA_CPP_DIR` / saved external path or bundled backend |
| `MIR_MODELS_DIR` | `LLAMA_MODELS_DIR` / saved path |
| `MIR_CTX_SIZE` | `LLAMA_CTX_SIZE` / auto |
| `MIR_PORT` | `LLAMA_PORT` / 9931 |
| `MIR_DEVICE`, `MIR_THREADS`, `MIR_GPU_LAYERS` | Corresponding `LLAMA_*` / auto |
| `MIR_PROMPT_PROCESSING` | `LLAMA_PROMPT_PROCESSING` / auto |
| `MIR_GENERATION_PRESET` | `LLAMA_GENERATION_PRESET` / default |
| `MIR_CACHE_TYPE_K`, `MIR_CACHE_TYPE_V` | Corresponding `LLAMA_ARG_*` / q4_0 |
| `MIR_SPLIT_MODE`, `MIR_TENSOR_SPLIT`, `MIR_FIT_TARGET` | Explicit values, otherwise native `LLAMA_ARG_*` behavior |

Individual sampling controls use `MIR_TEMPERATURE`, `MIR_TOP_P`, `MIR_TOP_K`,
`MIR_MIN_P`, `MIR_REPEAT_PENALTY`, `MIR_PRESENCE_PENALTY`, `MIR_FREQUENCY_PENALTY`,
`MIR_SEED` and `MIR_MAX_TOKENS`, with corresponding legacy `LLAMA_*` aliases.
Native `LLAMA_ARG_*` variables pass through; explicit GUI launch arguments take
precedence according to llama.cpp's parser. Requests may override server sampling
defaults without changing another client's stored preferences.

The App Store edition keeps configuration/data beneath its sandbox home and
ignores external HOME/XDG root overrides. It does not automatically import regular
edition storage. Choose model folders through its native picker; persistent
security-scoped bookmarks restore access after restart. Missing grants require
selecting the folder again. Native Save panels grant export/download destinations.

## Local development

Install Node.js 22.13+, 24 or 26+, Rust 1.92+ with rustfmt/Clippy, Python 3.9+ for
packaging/tests, and the platform's [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
From the repository root:

```bash
npm --prefix mir/desktop ci
npm --prefix mir/desktop run desktop
```

The second command starts Vite and the native Tauri window. Select an external
llama.cpp build to use models. Dependencies are installed explicitly; there is no
private toolchain bootstrap. The app can be developed without weights or a GPU.

For browser-only UI work, `npm --prefix mir/desktop run dev` serves
`http://127.0.0.1:1420/`. Append `?scenario=empty`, `cpu`, `multiple`,
`unknown-memory`, `occupied`, `save-error`, `oom` or `history-error` for labelled
simulations. Production assets exclude the fixture service. A plain browser preview
reports that native services are unavailable.

Install browser test engines once, then run the checks:

```bash
cd mir/desktop
npm exec -- playwright install chromium webkit
cd ../..
bash mir/tests/run.sh           # Desktop, offline packaging and native window
bash mir/tests/run.sh desktop   # Formatting, lint, build, Rust and browser flows
bash mir/tests/run.sh native    # Real native window with a fixture server
bash mir/tests/run.sh packaging # Offline archive/backend and Store boundaries
```

The runner is the only shell script and works with macOS system Bash. ShellCheck
is optional locally and installed in CI. Tests use temporary user directories,
fake backends and local HTTP fixtures; no model or inference service is needed.
On headless Linux, the native suite uses Xvfb, a private D-Bus session and software
rendering when available. An explicitly requested native suite fails if neither
a display nor those tools exists; the default suite reports that check as skipped.

CI runs desktop, packaging boundaries and real native windows on Linux and macOS
CPU runners. Native WebDriver is debug-only and rejected in release builds.
See [desktop development](../desktop/README.md) for focused commands and pinned
upstream fixture contracts.

## Architecture

```text
React features → typed desktop service → Tauri commands → Rust configuration and storage
                                                       → native OS services
                                                       → supervised llama-server and HTTP/SSE
```

Rust owns configuration, profile compatibility, GGUF metadata discovery, ports,
process identity, shutdown, chat streaming, history and project storage. Linux
uses procfs/pidfd and macOS uses libproc. The desktop does not invoke shell or
Python helpers or system inspection commands. Bundled backends are located relative
to the native executable, independently of the working directory.

Frontend modules separate app composition, features, shared controls and domain
logic. All Tauri IPC passes through `src/services/desktop.ts`. Native defaults in
`src-tauri/src/configuration/defaults.json` are also imported by development fixtures.
Assistant presence is a replaceable renderer with reduced-motion, visibility and
cleanup handling. Its animation is presentation, not inference telemetry.

## Building packages

Run packaging commands from `mir/desktop` after `npm ci` and platform setup.
`packaging/llama-runtime.json` pins backend release `b12248`, its source commit and
per-architecture SHA-256 digests. Preparation verifies archives, copies only required
executables/libraries, and includes both licenses and provenance. It rejects unsafe
archive paths and unknown external dependencies. A failed preparation preserves
the previous result. `prepare` and `bundle` accept `--archive /path/to/archive.tar.gz`
for an existing official archive, still verified against the pinned digest.

### macOS

Build on the matching Mac architecture with Xcode command line tools:

```bash
python3 packaging/macos.py bundle --target aarch64-apple-darwin
```

Use `x86_64-apple-darwin` on Intel. The default creates the regular GUI and a DMG
with an Applications shortcut. Output is under
`packaging/generated/build/<target>/release/bundle/macos/`. Libraries, helper and
app are signed and checked; the DMG copies the signed app without rebuilding it.
The default ad hoc signature is for local testing. For direct distribution use
`--signing-identity "Developer ID Application: YOUR IDENTITY"`, then notarize and
staple the candidate using Apple's tooling before publishing. The packager does
not notarize, upload or publish. See [Tauri signing guidance](https://v2.tauri.app/distribute/sign/macos/).

`prepare` verifies and stages the backend without compiling. `--probe` explicitly
builds a separate sandbox diagnostic, under `generated/build-probe/`, with no chat
window. It checks backend version/help and writes an isolated report. Its
`--select-model` runtime option performs an optional CPU loading check through the
native picker; no model is downloaded. Loading diagnostics are separate from
normal development and do not establish inference performance.

### Ubuntu

Build on Ubuntu 24.04+ with the matching architecture, Tauri prerequisites,
`patchelf` and `dpkg-deb`:

```bash
python3 packaging/ubuntu.py bundle --target aarch64-unknown-linux-gnu
```

Use `x86_64-unknown-linux-gnu` on x64. Packages are under
`packaging/generated/build-ubuntu/<target>/release/bundle/deb/`. Install with
`sudo apt install ./<package>.deb` and open Mir.cpp from the application menu.
The native executable is `/usr/bin/mir-desktop`; private backend files live under
`/usr/lib/mir.cpp/backend/`, and licenses/provenance under `/usr/share/doc/mir-cpp/`.
There is no public launcher command or direct-model CLI.

The packager patches backend library lookup to `$ORIGIN`, extracts the actual
DEB into temporary storage, compares its backend/resources, verifies dynamic
loaders and checks the GUI's embedded assets and backend version/help. No model
is loaded. Runtime dependencies include glibc 2.39+, WebKitGTK 4.1, GTK 3,
libstdc++, OpenMP and OpenSSL 3; older distributions are not claimed compatible.

### App Store variant

`--app-store` builds the sandboxed GUI with persistent model-folder permissions.
Use a separate test application/container for local native checks:

```bash
python3 packaging/macos.py bundle --app-store --store-check --debug --target aarch64-apple-darwin
MIR_PACKAGE_TEST_BINARY="$PWD/packaging/generated/build-app-store-check/aarch64-apple-darwin/debug/bundle/macos/Mir.cpp Store Check.app/Contents/MacOS/mir-desktop" node tests/package-smoke.mjs
```

The check verifies backend discovery, attachment storage and persistence across
relaunches. Native picker cancellation, folder selection, restored access, file
import and export still need manual checks on each target Mac. Tiny invalid GGUFs
can check file access without weights or inference.

To prepare a certificate-signed Store candidate:

```bash
python3 packaging/macos.py bundle --app-store --target aarch64-apple-darwin \
  --signing-identity "3rd Party Mac Developer Application: YOUR IDENTITY" \
  --provisioning-profile /absolute/path/Mir.provisionprofile \
  --pkg-signing-identity "3rd Party Mac Developer Installer: YOUR IDENTITY"
```

The packager validates the profile, identifier, Team ID and signing certificate,
embeds the profile, signs parent/helper with their distinct entitlements and
verifies the optional `.pkg`. Output is under `generated/build-app-store/`.
Without a certificate/profile the output is an ad hoc local app. These commands
do not submit to Apple. See [Tauri's Store procedure](https://v2.tauri.app/distribute/app-store/).

### CI candidates and release approval

The optional packaging workflow builds macOS GUI/diagnostic/Store candidates and
Ubuntu DEBs on native ARM64/x64 runners. It retains packages and test evidence as
Actions artifacts. Trigger it from a branch with:

```bash
gh workflow run check.yml --ref YOUR_BRANCH -f packaging=true
```

Normal push checks do not download the backend. Building a candidate or merging
main does not publish a release. Verify installation/replacement, native dialogs,
permissions, dependency notices, signing/notarization and each supported platform
before release. Version, full candidate SHA and release notes require explicit
approval before tagging or publishing; never move a published tag.

## Troubleshooting

- **No models:** choose a readable folder containing supported GGUFs. An empty
  folder is a valid configuration state.
- **Backend unavailable:** reinstall a package with its backend, or select an
  existing external llama.cpp build in the regular edition.
- **Unsupported option/device:** inspect the selected server's help and log, then
  review explicit settings. Other builds may advertise different capabilities.
- **Port occupied:** choose another port or inspect the listener before stopping it.
- **Not enough memory / Needs restart:** stop the server, reduce context or prompt
  batching, or choose a smaller model. Read Technical details before restarting.
- **Source build fails:** check Node/Rust versions, Tauri prerequisites, dependency
  downloads and disk space. Installed packages do not need development tools.
- **Storage fails:** keep the window open, fix space/permissions and retry saving.
- **Store model access lost:** select the models folder again with the native picker.
