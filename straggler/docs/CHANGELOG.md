# Changelog

## Unreleased

- R005: unify local/cloud model selection with search and a Download models view, group Settings by destination, identify response destinations and soften cloud colors and decorative effects.

- R004: unify UI typography, radii, action hierarchy, semantic colors, dark native controls and minimum pointer targets; clarify interface copy without changing workflows.

- Add manual chat compaction with cancellable bounded summaries, preserved originals, editable summary dividers and unchanged conversation exports.

- Apply the Aurora palette to cloud chat and project areas, preserving aqua Settings and independent temporary-chat signals.

- Add optional cloud Chat Completions services with system-keychain credentials, explicit verification and first-send consent, declared capabilities and preserved local/temporary workflows.

- Search oversized chat attachments in memory, preserve cited passages with responses and include attachment text in sidebar search.

- Render accessible LaTeX formulas with local fonts and add copy, syntax highlighting and expansion controls to code blocks.

- Add reusable system prompt presets with atomic native storage, import previews, export and copy-based insertion into chat, default and project instructions.

Desktop development changes; no package release or tag is implied.

- D003: static globular-cluster and starfield assets, translucent surfaces and warm
  star accents, preserving the existing palette and hologram.
- D006: shared React select-only comboboxes throughout the app, with keyboard
  navigation, typeahead, visible focus, optional option descriptions and popup
  positioning/dismissal. Existing control identifiers and settings behavior remain.
- D001: included llama.cpp version, build number and GitHub release date recorded
  in packaging metadata; external version information parsed from stderr/stdout,
  with release date shown as “Not reported”. No runtime release lookup.
- D005: temporary chats and Ctrl/⌘+Shift+N, memory-only messages and attachments,
  explicit conversion through Save chat, and confirmation before leaving or closing.
  Temporary backends disable RAM prompt caching and logging; slot erase and process
  teardown clear the session before normal use resumes.
- D004: optional Hugging Face tokens in the system keychain, explicit Hub search
  and repository links, version/file selection, memory estimates, optional projector,
  gated access guidance, disk checks, resumable downloads and SHA-256 verification
  across split models. Models retain existing root-level compatibility and add
  two-level publisher/repository discovery. Folder creation uses the Tauri app data
  directory; selection uses native dialogs, the Flatpak FileChooser portal or
  macOS security-scoped bookmarks as appropriate.
- D007 records owner approval without changing immutable design references. D008
  adds real native implementation captures and verification limits. D002 remains
  superseded by D003.

Validation uses synthetic local HTTP/backend fixtures without weights or inference.
Linux checks passed for formatting, lint, types/build, unit/runtime contracts,
Chromium and the actual Tauri window. Browser WebKit could not launch on the local
host because `libavif16` and `libmanette-0.2-0` are absent. Live system keychain,
Flatpak portal permissions and signed macOS Store bookmark/child access still need
platform integration verification; macOS CI was not run in this session.
