# Mir.cpp user and developer guide

Mir.cpp presents local chat and manages a llama.cpp server. llama.cpp owns model
support, inference, device allocation and backend performance. Mir.cpp owns its
settings, command construction, GUI, process supervision and conversation storage.

## Desktop workflow

Source startup is `bash mir/mir.sh`, from the repository root. Paths are resolved
from the launcher location, so startup also works from another directory.
Startup prepares an embedded Tauri desktop; users do not run frontend or compiler
commands. Desktop servers listen on `127.0.0.1` and do not open a browser.

The published v1.0.0 installer still installs the terminal edition. This branch
stages the desktop for a later release; its installer extraction list requires a
desktop source archive. Keep the stable installation command on the published tag
until a desktop release is explicitly approved and published. No tags are moved.

Settings has six sections:

| Section | Controls |
| --- | --- |
| Model settings | GGUF selection, context, K/V cache formats, sampling, seed, output length and Chat defaults |
| Performance | Device, CPU threads, GPU layers, prompt processing and conditional advanced device settings |
| Server & port | TCP port, listener details, normal and separately confirmed force shutdown |
| Saved configurations | Load for review, save to selected, save as new and confirmed deletion |
| Folders | llama.cpp and recursively searched model directories |
| llama.cpp | Managed installation, updates, cancellation, rollback and build logs |

The model selector, server controls and logs remain available from chat. Edited
settings are distinct from the running configuration. Apply validates a draft;
loading a profile does not launch. Modified compares the draft with saved fields;
Restart required compares server-launch fields with the active server settings;
Chat defaults do not require a restart. The clickable server badge opens the log
and shows restart needs even outside Settings. Configuration identity sits under
the model name in chat. Profile-backed settings keep Apply changes visible while
scrolling; Folders and llama.cpp have their own save or operation actions.

The sidebar collapses to a 68px rail. The assistant presence panel collapses to a
60px rail; below 1100px it opens over the chat. Both choices are remembered in
native desktop preferences, separately from browser preferences and profiles.
State is written beside the decorative orb, including in the rail.

An empty model folder is allowed. Folder navigation does not save until Use this
folder is accepted. Hidden folders can be displayed or entered by path. Existing
llama.cpp folders may contain `build/bin/llama-server` or `bin/llama-server`; the
source-build layout takes precedence when both exist.

## Context, cache and generation

### Projects

Use **Projects → New** or **All projects → New project** to group related chats.
Names are required, unique without regard to case, and at most 80 characters.
Descriptions are optional and accept up to 200 characters. Star a project to pin
it in the sidebar. All projects supports search, recent/name sorting and Active
and Archived tabs. The sidebar's **New chat** always starts outside projects;
start a project chat from its page instead.

Inside a project, its instructions replace the system prompt. Empty instructions
fall back to the applied Settings prompt. The chat's **System prompt** chip shows
**Project instructions** and saves changes for every member chat. A chat's own
prompt is kept and becomes active again when the chat leaves the project.
Conversation options offer **Move to project…** and **Remove from project**;
moving a chat with an own prompt explains the change before confirmation.

Project files accept the same text/document formats and 10 MiB limit as chat
attachments. Mir.cpp keeps extracted text copies without changing original files.
Included files enter every request in full, in a stable system-message prefix
after the instructions. Include switches exclude a file without removing it.
There is no retrieval, embedding index, sharing or project memory.

The project meter compares that prefix with the running server's `n_ctx` minus
25% reserved for conversation and replies. It reports **close to the limit** from
75% of the available space and **over the limit** above 100%. Exact counts use
the running server's tokenizer; `≈` marks a fallback of about four characters per
token. These defaults are defined once in `src/domain/projectContext.ts`.
An over-limit project cannot start chats or send; **Review files** and
**Change context size in Settings** provide recovery without truncating content.
Changing an edited context size still requires applying/restarting as usual.

When the server has not reported `n_ctx`, the meter says **Capacity unavailable**
with the reason and permits sending. It invents no capacity or percentage.
Server context rejections remain in the chat's error region with the draft and
the same recovery actions. As soon as capacity is known, normal blocking applies.
No project instructions or files are silently dropped to fit a request.

During generation, project content, Include switches, name, description and star
can change for the next message. The request already sent keeps its snapshot.
Moving/removing the generating chat or archiving/deleting its project waits until
the response finishes or is stopped; the disabled action explains why. Other
member chats can still be moved, removed or deleted. All writes use the same
serialized-save mechanism as conversation history.

Archived projects and their chats remain readable. Restore the project to send,
start chats or change content; deletion also requires Restore. Deletion confirms
whether to delete chats too: by default they remain in Conversations with their
own prompt restored. Originals on disk are untouched. Move/remove, file removal,
archive and restore offer a brief Undo that reverses only that action. Confirmed
project deletion is permanent.

Chat exports retain the existing format. Both export actions include the prompt
effective **at export time**: current project instructions or Settings fallback
inside a project, the chat's own/inherited prompt outside it. Earlier prompt
versions, project metadata and project files are excluded, just like attachments.
Import continues to create an outside-project chat.

Project metadata is stored as `desktop/projects/<UUID>/project.json` beneath the
XDG data directory, and extracted text as `files/<UUID>.txt` beside it. IDs are
validated and writes are atomic. Conversation records keep their existing paths
and gain optional membership/own-prompt fields; loading older records does not
rewrite them. Recoverable deletion coordinates project/history changes and keeps
errors explicit, including cleanup failures after a successful deletion.

### Context and generation controls

Auto leaves context to llama.cpp. Zero requests the full model context; a positive
count is explicit. Context includes input and output. A supported GGUF can still
exceed memory or use a chat template unsupported by the server.

K and V cache defaults remain `q4_0`, matching the release. Choices come from the
selected server's help. Missing help preserves the current value. Quantized V may
require Flash Attention; mixed formats can have model/backend restrictions. Mir.cpp
reports native failures instead of inventing model-specific compatibility rules.

| Sampling choice | Temperature | Top-P | Top-K | Min-P |
| --- | --- | --- | --- | --- |
| Default | Native | Native | Native | Native |
| Focused | 0.6 | 0.95 | 20 | 0 |
| Exploratory | 1 | 0.95 | 20 | 0 |
| Min-P | 1 | 1 | 0 | 0.05 |

The explicit presets use repeat penalty 1 and presence/frequency penalties 0.
They are starting points. Applying one preserves seed, output length, context,
cache and performance settings. The label is derived from the sampling values.
Custom values are validated as literal numbers; expressions are rejected.

Seed may be Auto, -1 for random or a nonnegative 32-bit unsigned integer. Output
length may be Auto, -1 for no fixed limit, zero for input evaluation only or a
positive token count. A seed does not promise identical output across devices.
Reasoning text is displayed when returned by the server; removed launcher reasoning
settings in older profiles are ignored. Model behavior remains native.

System prompt and Reasoning in the composer apply from the next message. A chat
can inherit the applied defaults or store its own system prompt; an explicitly
empty per-chat prompt sends no system message. Chat defaults in Model settings
belong to saved configurations and count toward Modified. Editing a draft does
not change applied chat defaults until Apply changes or a profile save succeeds.
New defaults are an empty system prompt and no reasoning or effort override, so
older configurations retain the server's behavior.

On and Off send request-time controls, not server launch arguments. The native
service checks `/props` capabilities and uses `/apply-template` without inference
to check the reasoning switch. Effort choices are the template's advertised
`chat_template_caps.reasoning_effort_levels`; absent levels are not replaced with
invented budgets. Unavailable capabilities disable those controls, not server
controls. A selected effort that the running template does not advertise is
reported explicitly. Separate reasoning text is shown only when the server
returns it; raw thoughts in ordinary content cannot be classified as a reasoning
stream by Mir.cpp.

User messages have visible Copy, Edit and Regenerate actions. Save and regenerate
replaces the following response; editing or regenerating an earlier message also
removes later turns. The inline editor explains this before saving. Assistant
responses can be edited as Markdown without running the model. Reasoning stays
read-only and response statistics continue to describe the generated response.
Stopped and interrupted partial responses remain editable. A failed save keeps
the previous response and the editor text available.

The conversation row's options menu contains Export chat…, Export with reasoning…
and the existing Delete action. Export opens the native save dialog directly and
writes one UTF-8 `mir.cpp/conversation` version 1 JSON file. Ordinary exports omit
reasoning. Both exports omit attachments, statistics and request options other
than the system prompt. Import in the CONVERSATIONS heading accepts that format
or a plain array of `{role, content}` messages. It accepts `reasoning` as an alias
of `reasoning_content`. Import always creates and opens a new conversation; it
never merges or replaces existing history. Invalid files change nothing on disk
and show Import failed with the filename, explanation, details and Choose another
file. A valid import during generation stops and saves the partial response before
opening the imported conversation.

Attachments belong to the conversation and are included with every request as
blocks labelled with their filenames, in insertion order. Add files in the
assistant rail using the native chooser or native window drag-and-drop. Supported
formats are UTF-8 `.txt` and `.md`, `.docx`, `.xlsx`, `.pptx` and `.pdf`; files larger
than 10 MiB (shown as 10 MB in the interface) are rejected. Legacy Office formats,
CSV and OpenDocument are unsupported. Text extraction reads document text runs,
slides in declared presentation order, one labelled tab-separated block per
spreadsheet sheet, and PDF text in page order. PDFs without extractable text need
OCR before attachment; PDFs that require a password must first be saved as
unlocked copies. Images, formatting and uncached spreadsheet formula results
are not extracted.

Original attachment copies are kept under
`desktop/conversations/<conversation-id>/attachments/` within the XDG data path;
extracted text is stored in the conversation's atomic JSON record. Download saves
a copy of the stored original even if the source file has moved. Remove deletes
the stored original and extracted text; Delete removes the conversation and its
attachments. The file list sorts by type and name for display while storage and
requests keep insertion order. Failed reads stay in the current session's file
list and can be removed; they are not stored as successful attachments.

The Context counter uses the running server's `default_generation_settings.n_ctx`,
never training context or an edited setting. Without attachments it continues to
show the last reported response usage or streaming timings. With attachments it
shows an estimate of the current prompt including attachment text and the draft.
Text estimates use `/tokenize`; prompt estimates first use `/apply-template` when
available. If tokenization is unavailable, a clearly marked approximate estimate
uses UTF-8 bytes divided by four. Template or tokenizer differences can affect
estimates; Mir.cpp does not silently truncate input. Send is disabled when the
estimated prompt exceeds the known context size, and a fresh count checks the
request before generation. Unknown capacity remains unavailable; the server can
still report a context error. Missing telemetry does not block server controls.
Thresholds are under 75%, 75% to under 90%, and 90% or more; the displayed
percentage is rounded. Data from an earlier server run is not reused.

In the pinned upstream contract, context shift is disabled by default. A reply
can stop at the context limit; an input prompt that already exceeds the window
is rejected. When context shift is enabled and supported, the server can discard
part of the earlier context and continue. A `length` finish reason can also mean
an output-token limit. Mir.cpp does not claim which occurred without evidence.
See the pinned [server contract](https://github.com/ggml-org/llama.cpp/blob/a4d4f2fd4ec85ec6a0a9ece4870416c1b6cc24f5/tools/server/README.md)
and [context implementation](https://github.com/ggml-org/llama.cpp/blob/a4d4f2fd4ec85ec6a0a9ece4870416c1b6cc24f5/tools/server/server-context.cpp).

## Devices and memory

Device names and descriptions come from `llama-server --list-devices`. Auto lets
llama.cpp choose; CPU only passes `--device none --gpu-layers 0`. Explicit names,
including comma-separated device order, remain supported. No hardware vendor or
model filename determines GUI behavior.

Auto threads and GPU layers omit overrides. Explicit counts are validated. Prompt
processing changes input batching, not answer-generation sampling:

| Choice | Arguments |
| --- | --- |
| Default | No batch overrides |
| Low memory | `--batch-size 512 --ubatch-size 128` |
| Large batch | `--batch-size 2048 --ubatch-size 1024` |

Larger batches use more memory and do not guarantee a speed improvement. Flash
Attention remains native. When multiple usable devices are discovered, advanced
controls expose split modes advertised by server help, ordered device names,
relative proportions and fitting margins in MiB. Tensor mode is experimental.
Margins are fitting targets, not allocation limits or capacity guarantees. Saved
values are preserved; CPU-only startup omits GPU distribution arguments.

Memory information is optional and approximate. An unavailable measurement is not
zero and never disables server controls. macOS system-memory availability and
per-device budgets describe different things. Mir.cpp does not run an external
memory planner or certify whether a model fits.

## Ports, shutdown and failures

The port is checked before launch and when configuration is refreshed. Unknown
listener ownership still blocks launch. Server & port displays the available PID,
owner and process details. Stopping an unrelated listener requires confirmation;
force stop requires a separate confirmation after normal shutdown was attempted.
Process identities are rechecked before signaling. Permissions are never elevated
for shutdown. Closing Mir.cpp confirms cancellation and saving before stopping its
own server and build workers.

A failed request reports the error and preserves partial text. Stop response keeps
partial text too. Interrupted responses remain identifiable when history is reopened.
Request failures stay with their response. Open Technical details for the original
diagnostic; Review settings opens Model settings. Invalid settings are identified
under the relevant field without discarding edited values. Build failures appear
in Settings → llama.cpp, beside the build log.

Storage errors remain beside the composer. Retry saving writes the current
conversation again; Retry loading reloads unavailable history. New chat and history
switching are disabled while the current conversation has unsaved text. Settings,
logs and server controls remain available. Keep the window open until saving works;
Mir.cpp reports saved data only after the write succeeds.

An explicit fatal backend failure changes the server status to **Needs restart**.
For confirmed memory exhaustion, the persistent banner says **Not enough memory**.
Stop server asks for confirmation and releases the supervised server. The banner
then offers Review settings: consider a smaller context, Performance → Reading your message
(Prompt processing) → Low memory, or a less demanding model/quantization before restarting.
Settings and profiles are never changed automatically. These choices can reduce
memory demand; they do not guarantee that a model fits.

A healthy HTTP endpoint alone does not clear a recorded fatal backend failure.
The diagnosis belongs to that server run, remains available after Stop, and clears
when a new server is started. A generic Compute error is not diagnosed as OOM
without explicit memory evidence. Recoverable allocation warnings do not by
themselves block chat. This reports llama.cpp failures; it cannot prevent macOS or
another operating system from terminating processes when resources are exhausted.

## Files and configuration compatibility

| Data | Location |
| --- | --- |
| Saved folders | `${XDG_CONFIG_HOME:-$HOME/.config}/mir.cpp/paths.conf` |
| Named configurations | `${XDG_CONFIG_HOME:-$HOME/.config}/mir.cpp/profiles/*.conf` |
| Desktop history, UI preferences and session lock | `${XDG_DATA_HOME:-$HOME/.local/share}/mir.cpp/desktop/` |
| Managed llama.cpp builds | `${XDG_DATA_HOME:-$HOME/.local/share}/mir.cpp/llama.cpp/` |
| Private desktop toolchains | `${XDG_DATA_HOME:-$HOME/.local/share}/mir.cpp/toolchains/` |
| Verified desktop builds | `${XDG_CACHE_HOME:-$HOME/.cache}/mir.cpp/desktop/` |
| Installed command and program | `~/.local/bin/mir` and `${XDG_DATA_HOME:-$HOME/.local/share}/mir.cpp/` |

Profiles are plain `key=value` data. Current fields are model, context, port,
device, threads, gpu_layers, prompt_processing, cache_type_k, cache_type_v,
split_mode, tensor_split, fit_target, temperature, top_p, top_k, min_p,
repeat_penalty, presence_penalty, frequency_penalty, seed, max_tokens, chat_system_prompt, chat_reasoning and
chat_reasoning_effort.

Only model is required on load. Missing fields use port 9931, `q4_0` for both
cache types, an empty prompt, and Auto for the remaining controls, independently of current settings
or environment overrides. Unknown/removed keys are ignored. Invalid recognized
fields, duplicates and malformed lines reject the entire load. Older desktop
profiles, including their removed reasoning field, remain readable. Loading never
rewrites a file; saving writes current fields. Paths and chats stay separate.
The system prompt is a JSON string on one literal profile line, preserving
multiline Unicode text without sourcing or evaluating it. It accepts up to 65536
UTF-8 bytes without NUL. `chat_reasoning` is `auto`, `on` or `off`;
`chat_reasoning_effort=auto` omits an override. The old removed `reasoning` key
remains ignored and is distinct from these fields.

Names accept letters, numbers, spaces, dots, underscores and hyphens, start with
an alphanumeric character and have at most 80 characters. Overwrite and deletion
require confirmation. Failed writes preserve files and saved-profile association.
The association lasts for the desktop session. Previous `llama-launcher` settings
are copied atomically only when Mir.cpp settings are absent; originals are kept.

Desktop conversations use validated UUID identifiers and atomic JSON writes.
Their format and location are separate from llama.cpp browser storage. Mir.cpp
does not change browser conversations, browser generation preferences or model files.

## Advanced direct startup

```bash
MIR_LLAMA_CPP_DIR="$HOME/llama.cpp" \
MIR_MODELS_DIR="$HOME/models" \
bash mir/mir.sh "$HOME/models/model.gguf" --ctx-size 4096
```

A GGUF argument starts the server directly. Ctrl+C stops the owned server. This
path retains browser opening for the native Web UI; the desktop path never opens
it. Extra arguments retain their original boundaries and are interpreted by llama.cpp.
The compatibility `--tui` option has been removed.

Launcher settings use explicitly set `MIR_*` controls before legacy aliases.
Empty `MIR_*` values remain explicit; they are validated rather than silently
replaced. Native `LLAMA_ARG_*` variables retain their meaning. Trailing arguments
retain their native precedence over generated arguments.

| Mir.cpp control | Legacy fallback / default |
| --- | --- |
| MIR_LLAMA_CPP_DIR | LLAMA_CPP_DIR / saved path |
| MIR_MODELS_DIR | LLAMA_MODELS_DIR / saved path |
| MIR_CTX_SIZE | LLAMA_CTX_SIZE / auto |
| MIR_PORT | LLAMA_PORT / 9931 |
| MIR_HOST | LLAMA_HOST / native host default |
| MIR_DEVICE | LLAMA_DEVICE / auto |
| MIR_THREADS | LLAMA_THREADS / auto |
| MIR_GPU_LAYERS | LLAMA_GPU_LAYERS / auto |
| MIR_PROMPT_PROCESSING | LLAMA_PROMPT_PROCESSING / auto |
| MIR_GENERATION_PRESET | LLAMA_GENERATION_PRESET / default |
| MIR_CACHE_TYPE_K, MIR_CACHE_TYPE_V | Corresponding LLAMA_ARG_CACHE_TYPE_* / q4_0 |
| MIR_SPLIT_MODE, MIR_TENSOR_SPLIT, MIR_FIT_TARGET | Explicit launcher values, otherwise native LLAMA_ARG_* behavior |

Individual generation controls are MIR_TEMPERATURE, MIR_TOP_P, MIR_TOP_K,
MIR_MIN_P, MIR_REPEAT_PENALTY, MIR_PRESENCE_PENALTY, MIR_FREQUENCY_PENALTY,
MIR_SEED and MIR_MAX_TOKENS, with corresponding legacy LLAMA_* aliases.
GUI settings configure server defaults. Requests from another client, including
browser chat, may override those defaults. Mir.cpp sends chat messages and streaming
requests without overwriting another client's preferences.

## Preparation, maintenance and removal

Preparation uses compatible existing Node and Rust tools when available. Otherwise
it installs private toolchains, verifies official download checksums and leaves the
user's login shell unchanged. Node 22 (22.13+), Node 24 or Node 26+ and
Rust 1.92+ are supported by the current desktop build. Node 24 is the private fallback.
Network access is required for first preparation and dependency downloads.

Desktop source content and host architecture identify cached builds. Preparation
compiles in staging, verifies embedded assets and activates only a successful result.
Cancellation stops the compiler process group and removes incomplete staging. A
failed build leaves previously verified cache entries intact. Cached executables
are self-checked before reuse. The cache may be removed after closing Mir.cpp; a
later launch rebuilds it. The cache uses private per-user toolchains and build files.

Missing system packages require explicit consent. Ubuntu/Debian uses apt; macOS
uses an existing Homebrew installation and Apple command line tools. Other Linux
distributions need equivalent dependencies installed manually. Builds run as the
user. Administrator authorization is restricted to package installation.

Managed llama.cpp updates retain the working build until checkout, compilation
and executable checks succeed. Source tags and Web UI assets are matched and
checksummed. Restore previous build selects the previous verified managed build.
Model settings and conversations are preserved. GPU drivers are external requirements.

Mir.cpp installation uses versioned archives and a managed wrapper. Updating an
active desktop is rejected. Desktop preparation must succeed before activation;
failed preparation preserves the previous installation. Stable release updates use
the current README's versioned curl command, after closing the app.

Remove an installed program using `mir --uninstall` and confirm when prompted.
Models, external llama.cpp builds and personal settings are preserved. Stop the
server and close the desktop first. An unrelated command is never replaced or removed.

## Development on one computer

Mir.cpp is written for humans to read, maintain, and improve. Keep responsibilities
explicit and use the formatter instead of compressing control flow or JSX.

Developer tools are Bash 4.4+, Python 3, compatible Node/npm and Rust with rustfmt
and Clippy. ShellCheck is recommended. Native builds additionally need the platform's
Tauri prerequisites; these are development dependencies, not inference hardware.

```bash
bash mir/tests/run.sh          # Common, platform, desktop and available native-window checks
bash mir/tests/run.sh common   # Launcher and preparation tests
bash mir/tests/run.sh desktop  # Frontend, contracts, Rust and browser flows
bash mir/tests/run.sh native   # Real desktop window with local test server
bash mir/tests/run.sh packaging # Offline archive and backend lifecycle checks
```

The runner prepares missing npm dependencies and Playwright browsers. It never
installs system packages or downloads model weights. Tests isolate HOME and XDG
directories. Native OS checks run on the matching host and report other checks
as skipped. Linux native-window tests need a graphical session or `xvfb-run`.

For UI work, run `npm run dev` from mir/desktop and open one of these URLs:

| URL | Scenario |
| --- | --- |
| `http://127.0.0.1:1420/?scenario=empty` | First-time setup |
| `?scenario=cpu` | No accelerators |
| `?scenario=multiple` | Multiple generic devices |
| `?scenario=unknown-memory` | Missing memory measurements |
| `?scenario=occupied` | Normal and force listener confirmations |
| `?scenario=save-error` | Failed persistence and retry |
| `?scenario=model-error` | Unsupported chat request |
| `?scenario=interrupted` | Interrupted response |
| `?scenario=cancel` | A response waiting for cancellation |
| `?scenario=oom` | Fatal memory failure during a response and reviewed recovery |
| `?scenario=oom-startup` | Fatal memory failure while loading |
| `?scenario=oom-and-save-error` | Independent server and persistence failures |
| `?scenario=compute-error` | Unknown compute failure without an OOM diagnosis |
| `?scenario=history-error` | Unavailable conversation storage |
| `?scenario=build-error` | Build failure in the llama.cpp settings section |

These pages clearly identify simulated services. They need neither Tauri nor
llama.cpp. Fixture transport is removed from production assets. A preview without
a scenario reports unavailable native services. `npm run desktop` starts native
development; `npm run format` applies frontend formatting.

The frontend's desktop service owns Tauri access. Development scenarios replace
that boundary; browser tests use the same scenarios instead of rewriting Tauri's
private internals. A contract test compares fixture settings with the real Bash
bridge and checks older desktop profiles. Rust integration tests use that bridge,
a local HTTP server and compiler fixtures to verify streaming, persistence,
configuration, process identity, cancellation, builds and rollback.

Native tests use an embedded W3C WebDriver server on Linux and macOS. Automation
is enabled only by the explicit `native-tests` feature in debug builds; release
compilation rejects that feature. The harness uses the standard HTTP protocol,
without a custom WebKit inspector client or another JavaScript test framework.

CI runs common, platform, desktop and native-window checks on Ubuntu and macOS
CPU runners. A developer needs one personal computer. Real inference and GPU checks
are optional diagnostics for the external integration, never a GUI development or
release gate. Validate API and command contracts, error handling and user flows;
llama.cpp remains responsible for inference correctness and backend performance.

## Architecture and release maintenance

Frontend code is grouped into app composition, feature components/hooks, shared
controls, domain types and the desktop service. Native modules separate commands,
workspace/bridge, server supervision, diagnostics, chat streaming, builds and history.
The launcher owns setting validation and returns field identifiers through the
private bridge. The UI uses shared Feedback, FieldError, popover and reasoning controls; each feature
owns the placement and recovery actions for its errors.

```text
React features → desktop service → Tauri runtime → mir.sh --desktop
                                              → local llama-server HTTP API
```

Assistant presence is a presentation boundary accepting only its seven-state
contract and optional response measurements. `domain/presence.ts` maps actual
server and stream states; responses from earlier server runs cannot leave stale
stopped/error presence. `features/presence/createRenderer.ts` selects the renderer
at one point. A replacement implements mount, setState, setPaused, resize and
destroy. Canvas and particle details stay inside the current orb renderer.
The renderer adapts the supplied 1.11 engine as an ES module, preserving its visual
design while reusing particle buffers, colour sprites and shared ring calculations.
It draws once per `requestAnimationFrame` callback, following the refresh cadence
the webview provides without a fixed frame-rate cap. Motion uses the callback's
elapsed time, so higher or changing refresh rates do not speed up the animation.
Long event-loop stalls are clamped to avoid large jumps or catch-up work.
The [HTML rendering model](https://html.spec.whatwg.org/multipage/webappapis.html#rendering-opportunity)
allows the browser to reduce that cadence for load, visibility or power policy;
matching a physical display's maximum refresh rate is not guaranteed.
Quiet states come to rest; reduced motion uses a still frame.
Pausing cancels pending frames, and resuming resets the clock to avoid a jump.
The engine is destroyed on unmount. Visibility combines DOM state with
read-only native window visibility/minimization checks to handle the desktop
window lifecycle independently of the webview. Native
visibility checks are canceled when the presence component unmounts.

Chat keeps the textual Thinking/Generating indicator without a second rotating
SVG spinner. In local Linux WebKit software-rendering comparisons, removing its
rotation restored the orb's refresh cadence in the complete chat. This is evidence
for that configuration, not a claim that SVG animations are slow on every webview.
The optional native orb diagnostic records frame intervals and GUI CPU use;
deterministic renderer tests cover fixed and changing refresh rates independently
of the runner's display or rendering speed.

Production layouts use explicit React classes instead of `:has()`. Composer width
observation also handles webviews without container queries, and the save bar has
a fallback layout for missing sticky positioning. The design's type floor is 11px.

The private bridge reuses launcher validation, profiles, discovery and native
argument construction. Platform services own OS operations and build metadata;
the UI does not select behavior from hardware brands. Keep runtime-files.txt and
the generated installer aligned when moving bundled source files. Regenerate with
`bash mir/sh/build-install.sh`; verify with `--check`.

Keep stable installation pinned to a published tag. Before a later desktop
release, update the canonical installer's release_tag and the README stable command
for the approved version, regenerate the installer, and test its exact archive.
Removing the old interface affects documented behavior and must be reflected in
the version and release notes. Obtain approval for version, full candidate SHA and
notes before creating a tag or publishing. Never move an existing tag.

## macOS backend packaging experiment

This branch includes a local packaging experiment, not a distributable desktop
release. The same Tauri executable can be built in `packaging-probe` mode to check
an included official `llama-server` without starting the Bash/Python bridge or
loading profiles, conversations or preferences. Normal desktop startup still
uses the existing launcher. Ubuntu packaging and migration of configuration into
Rust are subsequent work.

`mir/desktop/packaging/llama-runtime.json` pins candidate upstream release `b12248`,
its full source commit, and independent SHA-256 digests for macOS ARM64 and Intel.
This candidate is not the backend of a published Mir.cpp release. Preparation
verifies the entire archive before reading its members, follows the server's
transitive Mach-O library dependencies, rejects external installation paths, and
copies only the server, required libraries, archive license and provenance. It
never extracts archive paths or creates archive-provided links. Failed preparation
keeps the previous prepared backend; an interrupted directory replacement leaves
a `.previous` directory that must be recovered before retrying.

From `mir/desktop`, inspect and prepare either target on Linux or macOS:

```bash
python3 packaging/macos.py prepare --target aarch64-apple-darwin
python3 packaging/macos.py prepare --target x86_64-apple-darwin
```

Preparation requires Python 3.9+ and network access to the pinned GitHub asset.
`--archive /absolute/path/to/archive.tar.gz` accepts an already downloaded archive
and still checks its pinned digest. Generated files stay in the ignored
`packaging/generated/` directory. No model is downloaded or executed by preparation.

On a Mac with the existing frontend/Rust development tools and Xcode command line
tools, build the matching architecture:

```bash
npm ci --no-audit --no-fund
python3 packaging/macos.py bundle --target aarch64-apple-darwin
```

Use `x86_64-apple-darwin` on Intel. The command builds an `.app` named
`Mir.cpp Backend Check.app`, includes the pinned server and libraries, adjusts the
server's library search path, signs nested libraries and the helper before the
application, then verifies the signatures and the helper's entitlements. The
default identity is `-`, a local ad hoc signature. `--signing-identity "IDENTITY"`
selects a certificate already present in the developer's keychain; no certificate
is created, exported or uploaded. This command does not notarize, publish, or
submit the application to the Store.

The parent enables App Sandbox, user-selected read-only files and client/server
network access. The helper has exactly `app-sandbox` and `inherit`; it obtains
the parent's static permissions. The generated configuration replaces launcher
resources with the archive license and provenance. It uses the distinct application
identifier `io.github.etufarini.mir.packaging-check` for native diagnostic storage.
Python, Node, Rust and command line build tools are developer requirements, not
dependencies of the resulting diagnostic app.

Launch the app to check `--version` and `--help`, including whether the backend
reports the pinned commit. Its result dialog gives the path to the atomic
`backend-check.json` report in that application's native data directory. A failure
to save the report is itself a failed check. For unattended execution:

```bash
"packaging/generated/build/aarch64-apple-darwin/release/bundle/macos/Mir.cpp Backend Check.app/Contents/MacOS/mir-desktop" --no-dialog --allow-force-stop
```

`--allow-force-stop` explicitly permits SIGKILL only for a still-owned diagnostic
child that fails to exit after SIGTERM. Interactive runs request separate native
confirmation. Refusing SIGKILL keeps waiting with ownership of the child; a
noninteractive run without the flag also keeps waiting instead of forcing exit.
Quit requests confirm cancellation and wait for cleanup. SIGINT, SIGTERM and
SIGHUP request cancellation directly.

For the optional model access check, launch with `--select-model`. Choose a local
GGUF in the native picker, or cancel. The helper loads it with GPU layers disabled,
a context of 512, one slot and warmup disabled, checks loopback `/health`, and stops
without generating a response. This may require significant RAM and is an optional
integration diagnostic. No real model or hardware is required by automated tests.
The report contains logs which can include the selected model's private path;
review it before sharing. Model readiness is not evidence of successful inference.

The `Optional macOS backend packaging` workflow is manually dispatched on Apple
Silicon and Intel CPU runners. It builds with local signing and runs only version
and help checks with system-only `PATH`, without model weights or Homebrew tools
available to the app. Diagnostic output is retained; this experiment publishes no
installers. It is not a replacement for the normal Linux/macOS CI checks.

Before adopting this packaging for releases, run it on the target Macs and verify
native model selection, cancellation, loading, shutdown and report storage. The
current experiment does not implement persistent security-scoped bookmarks or
demonstrate reopening a model after relaunch. Distribution signing, notarization,
Store provisioning, dependency notices and the minimum supported macOS version
still need validation. In particular, the upstream Intel artifact disables Metal;
backend availability must be discovered from each selected artifact.

The fixture flags and health statuses follow the candidate's
[argument definitions](https://github.com/ggml-org/llama.cpp/blob/b12248/common/arg.cpp)
and [server contract](https://github.com/ggml-org/llama.cpp/blob/b12248/tools/server/README.md).
Packaging follows [Tauri sidecars](https://v2.tauri.app/develop/sidecar/),
[Tauri macOS bundles](https://v2.tauri.app/distribute/macos-application-bundle/),
and Apple's [embedded helper signing guidance](https://developer.apple.com/documentation/xcode/embedding-a-helper-tool-in-a-sandboxed-app).
Apple documents [file access and bookmarks](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)
separately; passing a pathname alone must be tested in the signed sandbox.

## Troubleshooting

- **No models:** choose a readable models folder and check that it contains GGUF
  files supported by llama.cpp. Empty folders remain usable configuration states.
- **Server unavailable:** select a folder containing an executable server or install
  a managed build. Both source-build and packaged layouts are accepted.
- **Unsupported option or device:** inspect the server log and installed build's
  help/device list. Review explicit settings; another machine may expose other devices.
- **Port IN USE:** choose a free port or inspect the listener before confirming a stop.
- **No memory measurement:** continue using the controls; llama.cpp reports loading
  failures. A missing measurement is not a capacity prediction.
- **Not enough memory / Needs restart:** stop the server, review context and prompt
  processing, then restart. Read the log for the original diagnostic. If it still
  fails, choose a smaller model or quantization.
- **Preparation fails:** inspect terminal output, system prerequisites, network access
  and disk space. Existing builds and user data remain available.
- **Storage fails:** keep the window open, fix space/permissions and retry saving.

## Recorded hardware checks

These are earlier results, not checks rerun for every documentation or launcher
change. Automated fixtures and native OS checks do not establish GPU inference
coverage; results apply only to the recorded configurations.

### Metal

Recorded macOS smoke checks used Auto, CPU only and explicit Metal with
`stories260K.gguf`, covering health, Web UI, completion and shutdown. They do not
establish performance, large-model capacity or coverage of other hardware
configurations. The original record does not identify the macOS or llama.cpp version.

### CUDA

Recorded smoke checks on 2026-11-06 used:

| Component | Tested configuration |
| --- | --- |
| System | Ubuntu 26.04.1, NVIDIA driver 615.71.09, CUDA toolkit 12.4 |
| GPU memory | Two devices with 6 GiB and 12 GiB |
| llama.cpp | b12177, commit `6c01da6278ab6c69ed67d9124806b50d2b299ba7` |
| Model | `gemma_4_26b_a4b_it_qat_ud_q4_k_xl.gguf` |

| Mode | Result for this build and model |
| --- | --- |
| Single GPU | Inference passed on each card, with native CPU offload as needed. |
| Multi-GPU Auto and Layer | Passed, including reversed device order with corresponding proportions and margins. |
| Tensor (experimental) | Passed with explicit 2:1 proportions. Automatic fitting was not implemented; without proportions it exhausted the smaller GPU and exited 134. |
| Row | Failed with `does not support split buffers`. |

Checks covered health, short completion/chat requests, Web UI HTTP delivery,
JavaScript delivery on the Single-GPU and Layer cases, shutdown and resource
release after success and failure. Automatic context fitting also passed a short
chat request, choosing 26880 tokens; a full-context workload was not tested.
GPU allocations returned to baseline and listening ports were released.
Interactive browser use, sustained workloads, performance benchmarks, other
hardware configurations and other models were not verified. These checks do not
establish universal CUDA or multi-GPU compatibility.
