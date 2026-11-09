# Mir.cpp development instructions

## Purpose and boundaries

Mir.cpp is a GUI and launcher wrapper, not an inference engine. Development and required automated checks must run without GPU hardware, model weights, or a working llama.cpp installation. Validate Mir.cpp's interface contracts, user flows, persistence, and process lifecycle. Real inference and backend hardware checks are optional integration diagnostics.

Target Linux and macOS with Tauri 2, React and TypeScript. Keep device discovery and inference delegated to the installed llama.cpp. Derive selectable features from its advertised capabilities; do not hardcode models, device names, hardware vendors or assumed memory capacity. Missing telemetry must not block server controls. Earlier hardware records describe only those configurations, not validation of later GUI changes.

The desktop is the normal interface. Preserve direct startup with a GGUF path, native argument pass-through, existing settings and installation layout. Remove the compatibility TUI; do not introduce a second interactive interface. All code comments, UI messages and project documentation must be in English.

## Human-readable code

Write code for human maintainers, not for LLMs. Prefer explicit control flow, descriptive names, focused modules, and readable formatting. Optimize for understanding and safe changes.

Group code by responsibility. Keep JSX multiline, asynchronous operations named, errors explicit and comments focused on reasons and constraints. Share rules at their owning boundary instead of copying them into UI components or test doubles. Introduce abstractions only when they remove concrete duplication or clarify ownership; avoid arbitrary file-size targets.

At the end of development, review changed code and its dependencies for redundant, unused or unnecessary content. Remove it within the approved scope, preserving validation, compatibility and useful diagnostics. Report the cleanup or state that none was found. Documentation-only tasks need no code cleanup.

## Repository structure

Keep the visible root limited to README.md, AGENTS.md, LICENSE and mir/. The only shell launcher entry point is mir/mir.sh; installed startup remains mir. Resolve resources from MIR_ROOT independently of the working directory, including bundled desktop resources.

Keep shared launcher behavior in mir/lib/, platform adapters in mir/lib/platform/, shell tests in mir/tests/, the installer in mir/sh/, desktop code in mir/desktop/, and documentation in mir/docs/. Use explicit module imports. Adapters define functions without effects on import; shared features call platform services rather than branching on the OS. Linux must work without macOS files or Homebrew. Keep bootstrap syntax compatible with macOS Bash 3.2, then select and reuse Bash 4.4+ without changing the user's shell.

Organize the frontend into app composition, features, shared components, domain data and a typed desktop service. Keep Tauri IPC access in that service. Separate edited settings, saved settings and the active server configuration. Keep native commands thin and separate bridge operations, process supervision, builds, streaming and history.

## Configuration and compatibility

Use Mir.cpp, mir.sh, mir, MIR_ROOT and MIR_* consistently. Preserve MIR_* precedence over legacy LLAMA_* aliases, including explicit empty MIR_* values; leave native LLAMA_ARG_* variables unchanged. Read configuration and profiles as literal data, never source or eval.

Keep paths in ${XDG_CONFIG_HOME:-$HOME/.config}/mir.cpp/paths.conf and profiles in its profiles/ directory. Preserve release and earlier desktop profile compatibility: validate recognized fields transactionally, ignore removed or unknown keys, and initialize missing fields from documented defaults independently of the current session. Loading returns to configuration review without launching. Compare and save through the same field serialization; confirm overwrite and deletion. Keep migration atomic, preserve originals and never merge over existing settings.

Folders must be configurable and readable. Accept source builds with build/bin/llama-server and packaged builds with bin/llama-server. Discover GGUF files recursively, allow empty model folders, and report missing server/model files clearly. Browsing, accepting a directory and canceling are separate actions; hidden directories remain accessible.

Preserve release defaults, sampling presets, seed/output independence, cache types and advanced GPU settings. Discover supported cache types and split modes through native help. Auto omits the corresponding arguments; CPU only disables GPU layers. Explicit trailing arguments retain precedence. Do not infer model support from filenames or hardware identity from backend labels.

## Desktop behavior and data

Keep Settings organized as Model settings, Performance, Server & port, Saved configurations, Folders and llama.cpp. Keep model selection and server controls accessible from chat. Mark Modified relative to saved settings and Restart required relative to the active configuration. Report unavailable native services, unsupported chat requests, interrupted responses and storage errors explicitly.

Store conversations under ${XDG_DATA_HOME:-$HOME/.local/share}/mir.cpp/desktop/, separate from profiles and browser data. Validate identifiers and write atomically. Preserve partial responses and serialize saves. Do not overwrite browser conversations or preferences.

Start supervised desktop servers on loopback without opening a browser. Check ports before startup and after changes; unidentified listeners still block launch. Show available process details, recheck identity before signaling, request explicit SIGTERM confirmation for unrelated listeners and separate SIGKILL confirmation. Never elevate process-control permissions. Closing the app confirms cancellation, saving and cleanup of its own processes.

## Preparation and installation

Source and installed startup prepare the same embedded desktop automatically. Reuse compatible Node/Rust tools or checksum-verified private toolchains. Cache verified builds by source content, supervise cancellation and run compilation as the user. Internal bridge calls bypass GUI preparation. System package installation requires consent and is limited to supported Ubuntu/Debian or existing Homebrew setups; model files and GPU drivers remain external requirements.

Keep mir/sh/install.sh generated from install-core.sh and canonical adapters using build-install.sh; verify with --check. Update extraction manifests when moving runtime files. Activate an installed update only after desktop preparation succeeds, preserve the working installation on failure, and reject updates during an active desktop session.

## Verification

Use bash mir/tests/run.sh as the development entry point. Keep focused suites available and report skipped checks. Required checks use temporary user directories, fake executables and local HTTP fixtures; they must not install system packages, contact inference services or use personal configuration. Verify test fixtures against real bridge contracts and pinned upstream examples/documentation to prevent drift.

Run Bash syntax checks and ShellCheck for shell changes, frontend type/lint/format checks, relevant unit and integration suites, and Linux/macOS CI. Test native windows, resources and process behavior on CPU runners of each target OS. Exercise storage failures, cancellation, process identity, migration and installation rollback when affected. No GPU, inference workload or hardware inventory is a release gate. Choose representative interactions and boundaries rather than exhaustive combinations or coverage quotas.

## Documentation and releases

Keep README.md concise and practical: local desktop chat, requirements, stable curl installation, mir startup, first configuration and one link to mir/docs/guide.md. Include the human-maintainer principle. Keep detailed settings, direct startup, development commands, architecture, preparation, troubleshooting and earlier hardware records in the guide. Use real interface screenshots without fabricated readiness, inference or private paths.

Preserve versioned stable installation: README curl and installer download refer to the same published stable tag. main is development, and merging does not publish a release. Keep the installer version in its single release_tag value and regenerate the standalone artifact. Never move published tags. Use semantic versions and obtain approval for the exact version, candidate SHA and notes before tagging or publishing. Do not delete remote branches without approval.

## Approval

Every modification requires explicit user approval of the proposed scope before application, including edits to these instructions, renames and deletions. Existing approval persists for the presented work and its included cleanup; do not repeatedly request it. Read-only investigation is allowed. Present additional changes outside that scope for approval before applying them.
