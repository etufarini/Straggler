# Changelog

## 1.0.0 — release candidate

The first Straggler desktop candidate targets Linux and macOS with a pinned
llama.cpp backend. Proposed tag: `straggler-v1.0.0`; the historical Mir.cpp
`v1.0.0` tag remains unchanged. A candidate build is not a published release.

- Prepare application version 1.0.0 consistently across npm, Cargo, Tauri and the
  sidebar. Keep dependencies, profile formats and conversation exports unchanged.
- Keep Settings headers outside the scrolling fields viewport and preserve full
  control visibility after status notes resize it, including short WebKit viewports.
- Share native credential operations without changing account names, validation
  or service-specific errors. Remove the unused renderer factory and controller paths.
- Restore focus after project/attachment source dialogs close through Escape or Close.
- Document GitHub Releases, versioned DMG/DEB assets, checksums, installation,
  signing limits and replacement of the old release listing without retagging history.

- R008/R009: add a read-only Settings Overview, eight navigation destinations, unified model/memory/speed/server controls and configuration management beside Apply changes. Group backend and model folders with their related controls, clarify service status, align text actions and feedback, and use consistent form spacing. Settings, profiles, paths, environment controls and conversation formats are unchanged.

- R006: send generation defaults per message to local and supported cloud services without restarting; add isolated automatic Chat defaults persistence, local Model settings and configuration-load confirmation for defaults. Limit prose/settings width, order field help and errors accessibly, and show attachment drop/count feedback in the composer.

- R005: unify local/cloud model selection with search and a Download models view, group Settings by destination, identify response destinations and soften cloud colors and decorative effects.

- R004: unify UI typography, radii, action hierarchy, semantic colors, dark native controls and minimum pointer targets; clarify interface copy without changing workflows.

- Add manual chat compaction with cancellable bounded summaries, preserved originals, editable summary dividers and unchanged conversation exports.

- Apply the Aurora palette to cloud chat and project areas, preserving aqua Settings and independent temporary-chat signals.

- Add optional cloud Chat Completions services with system-keychain credentials, explicit verification and first-send consent, declared capabilities and preserved local/temporary workflows.

- Search oversized chat attachments in memory, preserve cited passages with responses and include attachment text in sidebar search.

- Render accessible LaTeX formulas with local fonts and add copy, syntax highlighting and expansion controls to code blocks.

- Add reusable system prompt presets with atomic native storage, import previews, export and copy-based insertion into chat, default and project instructions.

The following entries describe the desktop functionality included in the candidate.

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
The required workflow covers frontend/browser checks on Linux and native Linux/macOS
contracts, windows and process lifecycle. Release notes identify the successful runs
for the exact candidate and its package checks. Live system keychain, Flatpak portal
permissions, distribution signing/notarization and real inference are separate
integration checks; fixture and CI results do not establish those permissions or
hardware support.
