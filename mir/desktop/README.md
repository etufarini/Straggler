# Mir.cpp desktop development

Normal installed startup is `mir`; source startup is `bash mir/mir.sh` from the
repository root. Both automatically prepare the same embedded desktop app.
See the [user guide](../docs/guide.md) for installation, settings and data paths.

The shared layout follows [Tauri project structure](https://v2.tauri.app/start/project-structure/):
frontend code stays in src/, native code in src-tauri/src/, and platform packaging
overrides in src-tauri/tauri.macos.conf.json. Shared launch behavior stays in the
Bash bridge; lib/platform.sh and lib/platform.py hold Linux/macOS adapters.
See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for system tools.
The normal macOS preparation target is 13.5+ (the private Node 24 minimum).

This directory contains the React/TypeScript frontend and Tauri 2 native runtime.
The Bash bridge reuses launcher validation, paths, profiles, builds and memory
planning. Runtime settings and the edited draft are separate. Desktop chat does
not overwrite browser chats or model profile data.

For frontend-only development, npm run dev opens an explicit interface preview
without native services. npm run desktop starts Tauri's development workflow;
these commands are developer conveniences and are not required by users.
The release preparation path embeds frontend assets and runs no development server.

Tests: npm test, npm run test:runtime, npm run test:e2e and npm run test:native.
Rust runtime checks can use --no-default-features without GUI development headers.
The browser suite uses an explicit mocked native bridge. Runtime integration tests
exercise the real Bash bridge with test HTTP servers, release checkouts and compiler
fixtures; these are not inference or GPU validation. Automated native smoke tests use the Linux WebKitGTK inspector and require a
graphical session and a debug binary, use isolated temporary data and a test server,
and can select another binary using MIR_TEST_NATIVE. MIR_TEST_SHUTDOWN=signal checks
SIGTERM cleanup. On macOS, run the runtime/browser suites and verify the prepared
.app window, backend menu, fixture streaming, persistence and confirmed shutdown
through the native interface. Browser tests use /usr/bin/google-chrome unless MIR_TEST_BROWSER
selects another Chromium executable.

Keep runtime-files.txt aligned with the source files needed by the curl installer.
Do not include node_modules, dist, target, generated schemas or test output there.
The GUI sources stay under mir/desktop; public shell entry remains mir.sh.
