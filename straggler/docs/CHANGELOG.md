# Changelog

## 1.0.0 — 2026-11-22

The first Straggler desktop release is available for macOS 13.5+ on Apple Silicon
and Ubuntu 24.04+ on x86-64, with llama.cpp `b12248` included. Both packages support
CPU inference; the macOS backend also includes Metal. Linux GPU acceleration uses
an external compatible backend. Models and GPU drivers are supplied separately.

Download the packages and `SHA256SUMS` from
[Straggler 1.0.0](https://github.com/etufarini/Straggler/releases/tag/straggler-v1.0.0).
The macOS package is ad hoc signed, without Developer ID signing or notarization.
The release tag is `straggler-v1.0.0`; the historical Mir.cpp `v1.0.0` tag remains
at its original commit.

### Chat, files and projects

- Local GGUF chat with streaming responses, model selection and supervised server
  controls in the desktop app.
- Conversations and projects with shared instructions and documents, attachment
  search and cited passages preserved with responses. Sidebar search includes
  attachment text.
- Manual chat compaction with cancellable bounded summaries, preserved originals,
  editable summary dividers and unchanged conversation exports.
- Temporary chats and Ctrl/⌘+Shift+N, memory-only messages and attachments, explicit
  conversion through **Save chat**, and confirmation before leaving or closing.
  Temporary backends disable RAM prompt caching and logging; slot erase and process
  teardown clear the session before normal use resumes.
- Optional cloud Chat Completions services with system-keychain credentials,
  explicit verification and first-send consent, declared capabilities and preserved
  local/temporary workflows. Web search is optional.
- Accessible LaTeX formulas with local fonts, plus copy, syntax highlighting and
  expansion controls for code blocks.
- Reusable system prompt presets with atomic native storage, import previews,
  export and copy-based insertion into chat, default and project instructions.

### Models and settings

- Hugging Face search and repository links, version/file selection, memory
  estimates, optional projector selection, gated access guidance and optional
  system-keychain tokens. Downloads use disk checks, resumable transfers and
  SHA-256 verification across split models.
- Existing root-level GGUF discovery plus two nested publisher/repository levels.
  Model folder creation uses the app data directory; selection uses native
  dialogs or the Flatpak FileChooser portal where applicable.
- Unified local/cloud model selection with search and a Download models view.
  Response destinations are identified in the interface.
- A read-only Settings Overview and eight navigation destinations, grouped by
  all models, this computer, and cloud/web services. Model, memory, speed and
  server settings share one page, with configuration management beside Apply changes.
- Generation defaults sent per message to local and supported cloud services
  without restarting, automatic Chat defaults persistence and confirmation before
  loading defaults from a saved configuration.
- Included backend version, build number and upstream release date recorded in
  package metadata. External builds report version/build/commit through
  `llama-server --version`; an independent GitHub lookup displays a release date
  only when the upstream tag matches the reported commit.

### Interface and reliability

- Consistent typography, controls, dark native surfaces, pointer targets and
  accessible keyboard navigation. Shared comboboxes support typeahead, visible
  focus and popup positioning/dismissal.
- Globular-cluster and starfield assets, translucent surfaces and an animated
  assistant presence, with distinct cloud and temporary-chat appearances.
- Settings headers stay outside the scrolling fields viewport. Controls remain
  visible after status notes resize it, including short WebKit viewports.
- Project/attachment source dialogs restore focus after Escape or Close.
- Shared native credential operations preserve account names, validation and
  service-specific errors. Unused renderer factory/controller paths were removed.
- Real native interface captures document the application without fabricated
  inference or hardware readiness.

### Distribution, compatibility and verification

- Application version 1.0.0 is consistent across npm, Cargo, Tauri and the sidebar.
  Existing profile formats, folder/environment controls and version 1 conversation
  exports are preserved. Legacy mir.cpp roots are reused without merging data.
- Native DMG/DEB packages include required backend libraries, licenses and
  provenance. Versioned downloads, checksums and signing status accompany the release.
- Automated validation uses isolated user directories and synthetic local
  HTTP/backend fixtures without model weights or inference services. The required
  workflow covers frontend/browser checks on Linux and native Linux/macOS
  contracts, windows and process lifecycle. Release notes link the successful
  application and package checks for the published source.
- Live system keychain access, Flatpak portal permissions, distribution
  signing/notarization and real inference remain separate integration checks;
  fixture and CI results do not establish those permissions or hardware support.
