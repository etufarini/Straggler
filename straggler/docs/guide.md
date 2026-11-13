# Straggler user and developer guide

Straggler lets you chat with local GGUF models and keep related conversations and
files in projects. It manages a llama.cpp server on your computer; llama.cpp loads
the model and generates responses. You choose when to start and stop it.

For a first session, begin with [Getting started](#getting-started). For a specific
question, use the sections below:

- [Getting started](#getting-started): requirements, startup and your first chat.
- [Chat and conversations](#chat-and-conversations): prompts, reasoning, editing
  and conversation exports.
- [Working with files and projects](#working-with-files-and-projects): document
  support, shared instructions and context limits.
- [Settings reference](#settings-reference): each Settings section, defaults and
  when changes take effect.
- [Server controls and troubleshooting](#server-controls-and-troubleshooting):
  logs, shutdown and recovery from errors.
- [Data, backups and compatibility](#data-backups-and-compatibility): storage,
  backups, older settings and environment controls.
- [Development and architecture](#development-and-architecture): local setup,
  checks and code responsibilities.
- [Packaging and releases](#packaging-and-releases): native packages, signing and
  release candidates.

## Getting started

### What you need

To use local chat, you need macOS 13.5+ or Ubuntu 24.04+ with a graphical session,
on ARM64 or x86_64. Choose a package or build that matches your architecture.
Windows is not a supported native target.

You also need a GGUF model file supported by your selected llama.cpp backend and
enough memory to load it. GGUF is the model file format Straggler looks for in
your models folder. Model weights are supplied separately. You can open the app,
review its settings and develop it without a model or a running inference service.

GPU support depends on the backend and any drivers it requires. The bundled
Ubuntu backend is CPU-only; the regular edition can use an existing external
GPU-enabled build. Available devices and options come from the selected backend.
Memory estimates cannot guarantee that a model will fit.

### Open the app

**No desktop release has been published yet.** To try the current app, follow
[Local development](#local-development), which opens the native window from source.
Source sessions have no bundled backend unless one has been explicitly prepared.

The packaging tools produce macOS application bundles/disk images and Ubuntu
Debian packages with a pinned llama.cpp backend. If you are testing a locally
built package, open it as follows:

| Platform | Install and open |
| --- | --- |
| macOS | Drag Straggler from the disk image to Applications, then open it there. |
| Ubuntu | Install the `.deb` with your package manager, then open Straggler from the application menu. |

Installed startup does not compile code or download tools. Packages need no Bash,
Python, Node.js or Rust toolchain at runtime. Linux packages depend on system
libraries, including WebKitGTK and GTK. Models and GPU drivers remain separate.

### Configure your first chat

1. Open **Settings → llama.cpp**. For a source session without a backend, select
   **Choose external build** and choose an existing llama.cpp folder containing
   `build/bin/llama-server` or `bin/llama-server`. Packaged builds normally use
   their included backend. If that backend is unavailable, follow
   [troubleshooting](#other-common-problems).
2. In **Folders**, select **Choose folder** for **Models folder**. Browse to the
   folder containing your GGUF files and confirm your selection with **Use this
   folder** in the regular edition, or the native picker in the App Store variant.
   Subfolders are searched recursively; an empty folder is also valid while you set up.
3. In **Model settings**, choose a model. Review context size, memory format and
   reply settings, then select **Apply changes**. The
   [settings reference](#settings-reference) explains the controls.
4. Select **Back to chat**, then **Launch server**. Wait for the status to change
   from **Loading** to **Ready**. If startup fails, open the status badge for the
   log and follow [troubleshooting](#server-controls-and-troubleshooting).
5. Type a message and select **Send message**. The response appears in the chat.
   Select **Stop response** if you want to stop generation and keep the text
   received so far.

In the regular edition, opening folders only navigates: **Use this folder** saves
and validates your choice; **Cancel** keeps the previous folder. Use **Show hidden
folders** or enter a path to reach hidden directories. The App Store variant uses
the native folder picker to grant access to models.

To reuse the model and server settings later, save a configuration under
[Saved configurations](#saved-configurations). Conversations are stored separately.

### Find your way around

The top of chat keeps the model selector, server status and server controls
accessible. Open the model selector to choose or refresh models; **Load model**
starts the server with that selection. Select the server status badge to read its
log. Use the sidebar for conversations, projects and Settings.

Sidebar and assistant-panel expansion are remembered as desktop preferences,
separately from saved configurations and browser preferences. The assistant
animation reflects response state; it does not measure inference speed or prove
hardware readiness.

### Update or remove the app

Close Straggler before replacing its package. Application updates include backend
updates; you can also select an existing external build in the regular edition.
Remove the app through the operating system. Personal settings, conversations,
models and external backends are separate from the application payload. See
[Back up your data](#back-up-your-data) before moving or removing personal files.

## Chat and conversations

### Start a chat and set its instructions

Select **New chat** in the sidebar for a conversation outside any project. To
start a chat with shared instructions and files, open a
[project](#create-and-organize-projects) instead. Send with Enter or **Send
message**; use Shift + Enter for a new line.

To set instructions for this chat:

1. Open **System prompt** beside the message box.
2. Choose **Default** to inherit the applied Settings prompt, or **This chat** to
   enter your own instructions.
3. Select **Apply to this chat**. The change applies from the next message,
   without restarting the server.

An explicitly empty custom prompt sends no system message. Project chats use
their project's instructions, as described under
[Shared instructions](#shared-instructions).

### Use reasoning controls

The reasoning and effort controls beside the message box depend on what the
running model's chat template advertises. Unsupported requests are reported
explicitly. Separate reasoning appears only when the server returns it; it may
not be available for every model or backend. Changes apply to the next message.

### Edit or regenerate a response

Use the actions beside a message to copy or edit its text. A user message also
provides **Regenerate response**. Editing a user message and choosing **Save and
regenerate**, or regenerating an earlier turn, removes the later turns. The editor
or confirmation explains this before the change is saved.

Assistant responses can be edited as Markdown and saved with **Save response**.
Reasoning stays read-only. If saving fails, the editor and the previously saved
response remain available so you can retry.

**Stop response** ends the current generation and preserves partial text. An
interrupted response also keeps the text received so far. Request errors stay
with the response; open **Technical details** for the original diagnostic.

### Reopen or delete a conversation

Select a conversation in the sidebar to reopen it. To delete it, open its menu,
choose **Delete**, then review the **Delete conversation** confirmation. This
permanently removes the conversation and its stored attachments from this device;
original source files remain untouched. Export or back up anything you want to keep
before confirming.

### Export or import a conversation

Open a conversation's menu, select **Export chat…** or **Export with reasoning…**,
and choose a destination in the native Save panel. The export includes the
effective system prompt at export time. It does not include attachments, project
files or metadata, statistics, or other request options. Use a
[full data backup](#back-up-your-data) to preserve those stored files and records.

To import, select **Import** beside the sidebar's conversation list and choose a
JSON file. Each import creates a new conversation outside projects; it never
merges with or replaces existing history. Invalid files leave stored history
unchanged. See [Conversation export format](#conversation-export-format) for
accepted JSON formats.

## Working with files and projects

### Add documents to a conversation

Open the assistant panel beside chat and select **Add files** under **Attachments**,
or drop files onto the native app window. If the panel is collapsed, use **Expand
assistant panel** to open it. Straggler extracts text and includes each
attachment in every request for that conversation, in insertion order and labelled
with its filename. Original source files remain untouched.

Straggler stores a copy of each attachment and its extracted text. **Download**
works even after the source file has moved. **Remove** deletes the stored copy and
text; deleting a conversation removes its attachments too. A failed read remains
visible for removal without becoming a saved attachment.

### Supported files and extraction limits

The limit is 10 MiB per file, shown as **10 MB** in the interface. The same formats
and size limit apply to conversation attachments and project files.

| Format | Text used in requests |
| --- | --- |
| UTF-8 `.txt`, `.md` | Plain text content |
| `.docx` | Document text |
| `.xlsx` | Spreadsheet sheets; uncached formula results are excluded |
| `.pptx` | Text in the presentation's declared slide order |
| `.pdf` | Extractable text in page order; the file must be unlocked |

Images and formatting are excluded. Straggler performs no OCR, so scanned PDFs
need a text layer. Legacy Office formats, CSV and OpenDocument are unsupported.

### Create and organize projects

Projects group conversations around shared instructions and documents. For
example, a project can keep the same reference documents available to several
chats without adding them to each conversation separately.

1. Select **Projects → New** or **All projects → New project**.
2. Give the project a name. Names are required, unique ignoring case and limited
   to 80 characters; an optional description allows 200 characters.
3. Open the project to add instructions and files, then start a chat there.

Star a project to pin it in the sidebar. **All projects** supports search, sorting
and **Active**/**Archived** tabs. Sidebar **New chat** always starts outside projects.

### Shared instructions

Project instructions replace the system prompt of every member chat. Empty project
instructions fall back to the applied Settings default. The prompt chip in a
project chat edits those shared instructions.

A chat's own prompt is preserved while it belongs to a project and restored when
it leaves. Moving a chat explains any prompt change before confirmation. For
example, a chat with its own prompt uses the project's instructions after moving
in, then recovers its own prompt after moving out.

### Shared files and context limits

Add files from the project view. Included files are sent in full after the project
instructions, in stable order. Turn off a file's **Include** switch to leave it
stored without sending it. Straggler has no retrieval index and does not
select excerpts automatically.

The context window is the token budget shared by instructions, files, conversation
and replies. A token is a unit of text counted by the backend. Adding documents
uses part of this budget before the model can answer.

| Indicator | What it measures and what happens at the limit |
| --- | --- |
| Chat context counter | Estimates the current prompt and draft against the running server's `n_ctx`. Sending is blocked when the prompt exceeds known capacity; preflight also checks the assembled request. |
| Project meter | Reserves 25% of the running context for conversation and replies. It warns at 75% of the remaining project budget and blocks new chats and sending above 100% of that budget. |

The chat counter uses the running server's capacity, rather than a draft setting
or the model's training context. Backend tokenizer/template counts are used where
available. Approximate counts are marked; the project meter uses **≈** for a
fallback estimate of four characters per token.

If capacity is unknown, it is shown as unavailable and sending remains possible;
the backend can still reject the request. Straggler never silently truncates
content. To make room, exclude or remove files, or apply a larger supported
context and restart the server. A larger context may require more memory.

### Change, archive or delete a project

Changes to instructions or included files during generation apply to the next
request. The current request keeps its original snapshot. Moving or removing the
generating chat, or archiving or deleting its project, waits until the response
finishes or stops. You can still manage other chats.

Archived projects are read-only until restored. Moving or removing chats, removing
project files, archiving and restoring offer a brief **Undo** action. Confirmed
project deletion is permanent. The deletion dialog lets you choose whether to
delete chats too; by default, chats remain outside the project with their own
prompts restored.

Conversation exports include the effective prompt but omit project files and
metadata. To keep an entire project and its files, use a
[data backup](#back-up-your-data).

## Settings reference

### Apply, save and restart

Settings distinguish the values you are editing, the saved configuration and the
configuration used by the running server:

| Label | Meaning | What to do |
| --- | --- | --- |
| Unapplied changes | Edited values differ from the applied session settings. | Select **Apply changes** to validate and apply them. |
| Modified | Edited values differ from the associated saved configuration. | Save to that configuration, or save a new one, to keep the changes. |
| Restart required | Server launch settings differ from the running configuration. | Stop and launch the server to use the new values. |

**Apply changes** does not save a named configuration or restart the server.
Saving a configuration also applies the edited values. Chat defaults take effect
after Apply or a successful save, without restarting. Loading a configuration
returns to **Model settings** for review; start the server when you are ready.
Folders are saved separately after you accept and validate a directory.

### Model settings

Choose the GGUF to load, context size, memory format, reply style and chat defaults
in this section. A supported model can still exceed available memory or use a
chat template unsupported by the backend. Straggler does not infer model support
from filenames.

| Control | Meaning and default |
| --- | --- |
| Context size | **Auto** lets llama.cpp choose. **Largest the model supports** stores `0` and requests full model context. A positive token count requests an explicit size. Input and output share the context. |
| Keys format / Values format | K/V cache formats default to `q4_0`. Choices come from the selected server's help. Quantized V may require Flash Attention; llama.cpp reports model/backend restrictions. |
| Reply style | Sampling preset; **Default** leaves sampling values to the backend. Use **Fine-tune reply style** for individual controls. |
| Seed | **Auto**, `-1` for random, or an unsigned 32-bit integer. A fixed seed does not promise identical output across devices. |
| Longest reply (tokens) | **Auto**, `-1` for no fixed limit, `0` for input evaluation only, or a positive output token count. |
| Chat defaults | Default system prompt, reasoning and effort settings. The initial prompt is empty; reasoning and effort start at **Auto**. Chats can override these defaults. |

The sampling presets are starting points, not guarantees about a model's responses:

| Sampling preset | Temperature | Top-P | Top-K | Min-P |
| --- | --- | --- | --- | --- |
| Default | Native | Native | Native | Native |
| Focused | 0.6 | 0.95 | 20 | 0 |
| Exploratory | 1 | 0.95 | 20 | 0 |
| Min-P | 1 | 1 | 0 | 0.05 |

Here, **Native** means no explicit override is sent. Explicit presets use repeat
penalty 1 and presence/frequency penalties 0. Changing presets preserves seed,
output length, context, cache and performance settings.

Use **Fine-tune reply style** to adjust individual sampling controls. **Auto** or
an empty field uses the backend default. These controls influence how the next
token is selected:

| Control | Effect | Accepted explicit values |
| --- | --- | --- |
| Temperature | Higher values allow more varied choices; lower values favor likely tokens. | Nonnegative decimal |
| Top-P | Keeps the most likely tokens whose combined probability reaches this share. | 0 to 1 |
| Top-K | Keeps at most this many likely tokens; `0` disables this filter. | Nonnegative integer |
| Min-P | Removes tokens unlikely relative to the most likely token. | 0 to 1 |
| Repeat penalty | Discourages recent repetition; `1` is neutral. | Positive decimal |
| Presence penalty | Positive values discourage tokens that have already appeared. | Signed decimal; `0` is neutral |
| Frequency penalty | Positive values penalize tokens more as they recur. | Signed decimal; `0` is neutral |

### Performance

**Auto** omits the corresponding launch override so llama.cpp can choose. Flash
Attention is automatic. Device names come from `llama-server --list-devices`;
available cache types and split modes come from its help.

| Control | Behavior |
| --- | --- |
| Device | **Auto** lets llama.cpp choose. **CPU only** uses `--device none --gpu-layers 0`. Explicit device names use the selected backend's advertised identifiers. |
| CPU threads | **Auto** or an explicit count. More threads are not always faster. |
| Model on the GPU | GPU layers: **Auto**, **All**, or a count. **CPU only** disables GPU layers regardless of this value. |
| Reading your message | Prompt processing preset; **Default** uses native batch settings. |

| Prompt processing | Batch size | Microbatch size |
| --- | --- | --- |
| Default | Native | Native |
| Low memory | 512 | 128 |
| Large batch | 2048 | 1024 |

Larger batches use more memory and do not guarantee better performance.

When multiple usable devices are available, **Advanced: several devices** exposes
ordered device names, supported split modes, relative device proportions and
fitting margins in MiB. For example, proportions `2,1` request twice the share on
the first device; these are relative weights, not memory sizes. Use nonnegative
proportions with at least one positive value. Margins accept nonnegative integer
MiB values. Values follow device order. Tensor mode is experimental;
margins are fitting targets, not allocation limits. CPU-only startup omits GPU
distribution settings.

Memory measurements are optional and approximate. **Unavailable** means a reading
is missing, not that capacity is zero. Missing measurements never block server
controls. Device support depends on the backend and drivers; a backend label does
not establish hardware identity or guarantee a model will fit.

### Server & port

The default port is **9931**; valid ports range from 1 to 65535. Supervised servers
listen on `127.0.0.1`, so connections stay on this computer, and starting a server
does not open a browser.

To change the port, enter a value and select **Check port again** to apply settings
and refresh listener details. If the server is running, restart it to use the new
port. Any occupied port blocks startup, even when its listener cannot be
identified. See [Resolve an occupied port](#resolve-an-occupied-port) before
stopping another program.

### Saved configurations

A saved configuration, also called a profile in the file format, stores model,
reply and server settings. It does not contain folders or conversations.

To save a new configuration:

1. Review your edited settings.
2. Open **Saved configurations** and enter a **New configuration name**.
3. Select **Save as new configuration**. If the name already exists, review the
   overwrite confirmation before replacing it.

To reuse a configuration, select it and choose **Load configuration**. This opens
**Model settings** for review without starting a server. Use **Save to selected**
to replace a selected configuration after confirmation. **Delete configuration**
also requires confirmation; current settings and conversations remain available.

Names start with an alphanumeric character and accept letters, digits, spaces,
dots, underscores and hyphens, up to 80 characters. Failed writes preserve the
previous file and saved association. See [Profile compatibility](#profile-compatibility)
for older files and missing-field defaults.

### Folders

Use **Choose folder** to change the models directory or the external llama.cpp
directory. A folder is saved automatically once you select **Use this folder** and
validation succeeds. Browsing and cancellation leave the previous path in place.
Hidden folders can be shown or opened by path.

Model discovery searches readable folders recursively for GGUFs and allows empty
folders. An external backend folder must contain an executable
`build/bin/llama-server` or `bin/llama-server`; the source-build layout takes
precedence if both are present. Stop the server before changing its backend.

The App Store variant uses a native models-folder picker and does not allow
external backend selection. See [App Store data and permissions](#app-store-data-and-permissions)
for persistent access.

### llama.cpp

This section identifies the selected backend and displays available version,
commit and build details. The bundled backend is pinned; its updates arrive with
application updates. In the regular edition, use **Choose external build** to
select an existing build or **Use bundled backend** to return to the included one.
Stop the server before switching.

External builds can advertise different devices and options. Straggler discovers
those capabilities rather than assuming that every build supports the same
settings. The App Store variant always uses its included backend.

## Server controls and troubleshooting

### Start, stop and inspect the server

From chat, select **Launch server** or choose a model and select **Load model**.
Both start llama.cpp with the selected settings. **Ready** means the server is
available for requests. Open the status badge to read the server log; it retains
the latest 300 lines and can include local file paths, so review it before sharing.

**Stop response** cancels generation while preserving partial text. **Stop server**
shuts down the supervised backend. After changing launch settings, stop and launch
it again to clear **Restart required** and use the new configuration.

Closing the app asks you to confirm cancellation, saving and cleanup of its own
server. If saving fails, keep the window open and use the recovery controls below.

### Resolve an occupied port

1. Open **Settings → Server & port** and inspect the available listener details.
2. Prefer another available port if the existing program needs to keep running.
   Enter the new port and select **Check port again**.
3. If you intend to stop the unrelated program, select **Close programs using it**
   and review the confirmation. This requests normal shutdown with SIGTERM.
4. If it remains after that attempt, **Force quit…** requires a separate
   confirmation before sending SIGKILL.

Straggler rechecks process identity before signaling and never elevates
process-control permissions. A listener it cannot identify still blocks launch.

### Recover from storage errors

Saving errors appear beside the composer. Keep the window open, check free space
and write permissions for the [data directory](#storage-locations), then select
**Retry saving** to write the current conversation. New chats and conversation
switching wait while text is unsaved; Settings, logs and server controls remain
accessible.

If history could not be loaded, fix the storage problem and select **Retry
loading**. Failed response edits keep the editor open and preserve the previously
saved response. Preference errors are reported separately; the layout remains
usable for the current session.

### Recover from a backend failure

An explicit fatal backend failure sets **Needs restart**. Confirmed memory
exhaustion shows **Not enough memory**. To recover:

1. Read **Technical details** and the server log.
2. Stop the server.
3. Review context size, choose **Low memory** prompt processing, or select a
   smaller supported model as appropriate to the error.
4. Apply the settings and launch the server again.

Straggler does not change settings automatically. A healthy HTTP endpoint does
not clear a fatal failure; a new server run does. Generic compute errors are not
labelled memory exhaustion without supporting evidence, and recoverable allocation
warnings alone do not block chat.

### Other common problems

| Symptom | What to check |
| --- | --- |
| No GGUF models found | Select a readable models folder containing supported GGUF files, then refresh models. Subfolders are searched; an empty folder is valid but offers no model to load. |
| Backend unavailable | In source development, select an existing external build. For a package missing its included backend, reinstall the package or choose an external build in the regular edition. |
| Unsupported option or device | Read the server log and review explicit settings against the selected backend's advertised capabilities. Different builds may support different options. |
| Reasoning unavailable | Check the running template's advertised capabilities. Separate reasoning is shown only if the server returns it. |
| Context full | Exclude or remove files, or apply a larger supported context and restart. See [context limits](#shared-files-and-context-limits). Content is never dropped automatically to fit. |
| Native services unavailable | Open the native app. A plain browser preview cannot access the desktop services or run local chat. |
| Source build fails | Check Node/Rust versions, Tauri prerequisites, dependency downloads and free disk space. Follow [Local development](#local-development) for setup. |
| Store model access lost | Select the models folder again in the native picker to restore permission. |

## Data, backups and compatibility

### Storage locations

Settings and conversations use separate directories. These paths apply to the
regular edition on both Linux and macOS:

| Data | Location |
| --- | --- |
| Saved folders | `${XDG_CONFIG_HOME:-$HOME/.config}/straggler/paths.conf` |
| Saved configurations | `${XDG_CONFIG_HOME:-$HOME/.config}/straggler/profiles/*.conf` |
| Conversations, attachments, projects, preferences and session lock | `${XDG_DATA_HOME:-$HOME/.local/share}/straggler/desktop/` |

The path notation means: use `XDG_CONFIG_HOME` or `XDG_DATA_HOME` when set to a
nonempty value; otherwise use `.config` or `.local/share` under your home folder.
Model files and external backends stay in the folders you selected. Desktop
storage is separate from browser conversations and preferences.

Conversation attachment originals live under `conversations/<UUID>/attachments/`.
Project records live under `projects/<UUID>/project.json`, with extracted text in
`files/<UUID>.txt`. Identifiers are validated, writes are atomic and saves are
serialized.

### Back up your data

Close Straggler after saving and letting it stop its server. Copy both the active
configuration directory and the desktop data directory to your backup location.
Copy each directory in full so conversations, projects and stored files remain
associated. Back up model files and external builds separately if needed.

Before restoring, close the app and retain a copy of the current directories.
Restore each directory to its corresponding location; there is no automatic merge
between backups and existing history. On another computer, review folder paths
and model selections before launching the server.

A conversation export is useful for moving message text and its effective prompt.
It omits attachments and project records, so it is not a complete data backup.
For older installations, identify the active directories using the rules below.

### Earlier Mir.cpp installations

Straggler was previously named Mir.cpp. For each configuration/data root, an
existing `mir.cpp/` directory is reused when `straggler/` is absent. Its data and
session lock stay in place. If both directories exist, `straggler/` takes
precedence; nothing is copied, merged or deleted. Apply this rule independently
to configuration and data when locating a backup.

External backend metadata accepts `straggler-build.conf` or the legacy
`mir-build.conf`; the new filename takes precedence. Old `llama-launcher` settings
migrate atomically only when Straggler configuration is absent, with originals
preserved. Previous shell installations are not upgraded automatically, and the
old v1.0.0 terminal installer does not install the desktop app. Back up shared
settings and data before removing an old installation.

### Conversation export format

Exports are UTF-8 `mir.cpp/conversation` version 1 JSON, with optional reasoning.
The name is retained for compatibility with earlier exports. Import also accepts
a plain array of `{role, content}` messages and recognizes `reasoning` as an alias
for `reasoning_content`. Invalid imports leave stored history unchanged.

### Profile compatibility

Profiles are literal `key=value` data and are never executed. Only the model field
is required on load. Missing fields use independent defaults rather than values
from the current session: port 9931, `q4_0` caches, an empty system prompt and Auto
for other controls. Auto sampling corresponds to the Default preset.

Unknown or removed keys are ignored. Invalid recognized fields, duplicate
recognized keys or malformed lines reject the entire load, leaving the current
settings available.
Loading does not rewrite older profiles. Saving writes current fields; prompts
are JSON-encoded on one line to preserve multiline Unicode text as data.

### Environment controls

Environment values initialize a session. An explicitly set `STRAGGLER_*` value
wins over the corresponding `MIR_*` value, then the legacy fallback below.
Explicit empty values at either application prefix still take precedence; invalid
values are reported rather than replaced. The supervised server stays on loopback.

| Control | Legacy fallback / default |
| --- | --- |
| `STRAGGLER_LLAMA_CPP_DIR` | `LLAMA_CPP_DIR` / saved external path or bundled backend |
| `STRAGGLER_MODELS_DIR` | `LLAMA_MODELS_DIR` / saved path |
| `STRAGGLER_CTX_SIZE` | `LLAMA_CTX_SIZE` / auto |
| `STRAGGLER_PORT` | `LLAMA_PORT` / 9931 |
| `STRAGGLER_DEVICE`, `STRAGGLER_THREADS`, `STRAGGLER_GPU_LAYERS` | Corresponding `LLAMA_*` / auto |
| `STRAGGLER_PROMPT_PROCESSING` | `LLAMA_PROMPT_PROCESSING` / auto |
| `STRAGGLER_GENERATION_PRESET` | `LLAMA_GENERATION_PRESET` / default |
| `STRAGGLER_CACHE_TYPE_K`, `STRAGGLER_CACHE_TYPE_V` | Corresponding `LLAMA_ARG_*` / q4_0 |
| `STRAGGLER_SPLIT_MODE`, `STRAGGLER_TENSOR_SPLIT`, `STRAGGLER_FIT_TARGET` | Explicit values, otherwise native `LLAMA_ARG_*` behavior |

Individual sampling controls use `STRAGGLER_TEMPERATURE`, `STRAGGLER_TOP_P`,
`STRAGGLER_TOP_K`, `STRAGGLER_MIN_P`, `STRAGGLER_REPEAT_PENALTY`,
`STRAGGLER_PRESENCE_PENALTY`, `STRAGGLER_FREQUENCY_PENALTY`, `STRAGGLER_SEED` and
`STRAGGLER_MAX_TOKENS`, with corresponding legacy `LLAMA_*` aliases.

Native `LLAMA_ARG_*` variables pass through unchanged. Explicit GUI launch
arguments take precedence according to llama.cpp's parser. Requests can override
server sampling defaults without changing another client's stored preferences.

### App Store data and permissions

The App Store edition keeps configuration and data beneath its sandbox home and
ignores external HOME/XDG root overrides. It does not automatically import regular
edition storage; use its own container when backing up or restoring data.

Choose model folders through the native picker. Persistent security-scoped
bookmarks restore access after restart; if a grant is missing, select the folder
again. Native Save panels grant export and download destinations. This edition
uses only its included backend.

## Development and architecture

Straggler is written for human maintainers. Keep changes readable and validate
configuration, user flows, persistence and process lifecycle without GPU hardware,
model weights or a working llama.cpp installation. Real inference and hardware
diagnostics are optional integration work.

### Local development

For the native app, install Node.js 22.13+, 24 or 26+, Rust 1.92+ with rustfmt and
Clippy, and the platform's [Tauri development prerequisites](https://v2.tauri.app/start/prerequisites/).
Python 3.9+ is needed for test fixtures and packaging. Dependencies are installed
explicitly using existing platform tools; there is no private toolchain bootstrap.

From the repository root:

```bash
npm --prefix straggler/desktop ci
npm --prefix straggler/desktop run desktop
```

The second command starts Vite and opens the native Tauri window. Use it again
after setup. To chat with a model during development, select an existing external
llama.cpp build under **Settings → llama.cpp**.

For browser-only UI work, run `npm --prefix straggler/desktop run dev` and open
`http://127.0.0.1:1420/?scenario=empty`. Named scenarios provide clearly labelled
simulated services and responses. A plain browser preview reports that native
services are unavailable; production assets exclude the fixture service. The
[desktop README](../desktop/README.md#browser-fixtures) lists available scenarios.

### Run the checks

Use the repository's test runner as the development entry point. Install browser
engines once before running browser checks:

```bash
cd straggler/desktop
npm exec -- playwright install chromium webkit
cd ../..
bash straggler/tests/run.sh
```

On Linux, browser checks may also need Playwright system dependencies installed
explicitly during development setup. The runner does not install system packages.
The default suite checks common runner boundaries, frontend, runtime, browser and
native-window behavior. Offline archive checks are included in common checks;
`packaging` adds focused native resource/backend and Store boundary checks.

For focused work, append a suite name, for example:

```bash
bash straggler/tests/run.sh frontend
bash straggler/tests/run.sh runtime
bash straggler/tests/run.sh browser
bash straggler/tests/run.sh packaging
```

See the [suite table](../desktop/README.md#test-suites) for all choices and their
prerequisites. Frontend and browser checks need no Rust or native GUI libraries.
Runtime checks need Rust, Python fixture support and the host linker, but no npm
or native GUI libraries. Isolation and native-window checks need the host's Tauri
development dependencies.

Tests use temporary user directories, fake executables, generated documents and
local HTTP/SSE fixtures. They do not need personal configuration, a GPU, model
weights or an inference service. The runner works with macOS system Bash 3.2;
ShellCheck is optional locally and installed in CI.

On headless Linux, native checks use Xvfb, a private D-Bus session and software
rendering when available. An explicitly requested `native` suite fails without
a display or those tools; the default suite reports the native check as skipped.

CI runs frontend checks once and common, runtime, browser and real native-window
checks on Linux/macOS CPU runners. The isolation check compiles the actual desktop
without the opposite platform's module/configuration. Linux browser WebKit does
not replace native macOS WebView and process checks. Native WebDriver is debug-only
and rejected in release builds. Pinned upstream fixture contracts are listed in
the [desktop README](../desktop/README.md#upstream-fixture-contracts).

### Architecture

```text
React features → typed desktop service → Tauri commands → Rust configuration and storage
                                                       → native OS services
                                                       → supervised llama-server and HTTP/SSE
```

Rust owns configuration, profile compatibility, GGUF metadata discovery, ports,
process identity, shutdown, chat streaming, history and project storage. Linux
uses procfs/pidfd; macOS uses libproc. The app does not invoke shell/Python helpers
or system inspection commands. Bundled resources are resolved relative to the
native executable or resource directory, independently of the working directory.

Frontend modules separate app composition, features, shared controls and domain
logic. All Tauri IPC passes through `src/services/desktop.ts`. Native defaults in
`src-tauri/src/configuration/defaults.json` are also imported by development fixtures.
Assistant presence uses a replaceable renderer with reduced-motion, visibility
and cleanup handling; its animation is presentation rather than inference telemetry.

## Packaging and releases

### Building packages

Run the commands below from `straggler/desktop`, after `npm ci` and the host
platform setup. Build on the matching target operating system and architecture.
Plain `npm run bundle` builds the Tauri app without preparing the pinned backend;
use the packaging tools to produce a package containing that backend.

`packaging/llama-runtime.json` pins backend release `b12248`, its source commit and
per-architecture SHA-256 digests. Preparation verifies archives, copies only required
executables/libraries, and includes both licenses and provenance. It rejects unsafe
archive paths and unknown external dependencies. A failed preparation preserves
the previous result. `prepare` and `bundle` accept `--archive /path/to/archive.tar.gz`
for an existing official archive, still verified against the pinned digest.
Without `--archive`, preparation downloads the pinned upstream archive. Model
weights are never bundled or downloaded by these commands.

#### macOS

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

`prepare` verifies and stages the backend without compiling. To stage only the
backend, replace `bundle` with `prepare` in the platform's command. With `bundle`,
`--probe` builds a separate sandbox diagnostic under `generated/build-probe/`,
with no chat window. It checks backend version/help and writes an isolated report. Its
`--select-model` runtime option performs an optional CPU loading check through the
native picker; no model is downloaded. Loading diagnostics are separate from
normal development and do not establish inference performance.

#### Ubuntu

Build on Ubuntu 24.04+ with the matching architecture, Tauri prerequisites,
`patchelf` and `dpkg-deb`:

```bash
python3 packaging/ubuntu.py bundle --target aarch64-unknown-linux-gnu
```

Use `x86_64-unknown-linux-gnu` on x64. Packages are under
`packaging/generated/build-ubuntu/<target>/release/bundle/deb/`. Install with
`sudo apt install ./<package>.deb` and open Straggler from the application menu.
The native executable is `/usr/bin/straggler-desktop`; private backend files live under
`/usr/lib/straggler/backend/`, and licenses/provenance under `/usr/share/doc/straggler/`.
There is no public launcher command or direct-model CLI.

The packager patches backend library lookup to `$ORIGIN`, extracts the actual
DEB into temporary storage, compares its backend/resources, verifies dynamic
loaders and checks the GUI's embedded assets and backend version/help. No model
is loaded. Runtime dependencies include glibc 2.39+, WebKitGTK 4.1, GTK 3,
libstdc++, OpenMP and OpenSSL 3; older distributions are not claimed compatible.

#### App Store variant

`--app-store` builds the sandboxed GUI with persistent model-folder permissions.
Use a separate test application/container for local native checks:

```bash
python3 packaging/macos.py bundle --app-store --store-check --debug --target aarch64-apple-darwin
STRAGGLER_PACKAGE_TEST_BINARY="$PWD/packaging/generated/build-app-store-check/aarch64-apple-darwin/debug/bundle/macos/Straggler Store Check.app/Contents/MacOS/straggler-desktop" node tests/package-smoke.mjs
```

The check verifies backend discovery, attachment storage and persistence across
relaunches. Native picker cancellation, folder selection, restored access, file
import and export still need manual checks on each target Mac. Tiny invalid GGUFs
can check file access without weights or inference.

To prepare a certificate-signed Store candidate:

```bash
python3 packaging/macos.py bundle --app-store --target aarch64-apple-darwin \
  --signing-identity "3rd Party Mac Developer Application: YOUR IDENTITY" \
  --provisioning-profile /absolute/path/Straggler.provisionprofile \
  --pkg-signing-identity "3rd Party Mac Developer Installer: YOUR IDENTITY"
```

The packager validates the profile, identifier, Team ID and signing certificate,
embeds the profile, signs parent/helper with their distinct entitlements and
verifies the optional `.pkg`. Output is under `generated/build-app-store/`.
Without a certificate/profile the output is an ad hoc local app. These commands
do not submit to Apple. See [Tauri's Store procedure](https://v2.tauri.app/distribute/app-store/).

### Release candidates and approval

The optional packaging workflow builds macOS GUI/diagnostic/Store candidates and
Ubuntu DEBs on native ARM64/x64 runners. It retains packages and test evidence as
Actions artifacts. Trigger it from a branch with:

```bash
gh workflow run check.yml --ref YOUR_BRANCH -f packaging=true
```

Normal push checks do not download the backend. Candidate artifacts are for
review; building one or merging `main` does not publish a release. Before release,
verify installation and replacement, native dialogs, permissions, dependency
notices and signing/notarization on each supported platform. No GPU workload or
hardware inventory is a release gate.

Use semantic versions. The exact version, full candidate SHA and release notes
require explicit approval before tagging or publishing. Never move a published
tag or delete a remote branch without approval.
