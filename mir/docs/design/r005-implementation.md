# R005 implementation record

The owner approved cumulative R002–R005 implementation and subsequently approved
using `ce5852682ad0de0ec833d9e8e13d149b07a84bbb` as the branch base because `main`
(`4477cb34c07578bf69ae1a66f1251c5a882f8dd4`) does not contain the desktop.

Branch: `feature/r005-chat-actions-attachments-export-import`.

## Starting baseline

`bash mir/tests/run.sh desktop` passed before changes:

- Prettier, ESLint, TypeScript/Vite build, Rust formatting and Clippy passed.
- Frontend unit tests: 24 passed across 5 files.
- Rust tests: 10 unit and 11 integration tests passed; no doctests.
- Browser tests: 58 passed across Chromium and WebKit.
- Native windows and platform CI were not run in this baseline.

## Immutable design evidence

`mir-ui-design-R005.html` was copied byte-for-byte from the supplied file.
SHA-256: `8e192310f24078daa40eafdb5df9da2f097f0d8af39d8b879dceacc4836b23fd`.

The existing `mir-ui-design.html` and reference files remain in the owner's
original checkout and are not modified or added by this implementation.
Original dossier SHA-256:
`f0934e5d5a8f091f8a806727ec012c1c829e823dad436e6fb39cfe98d3f6df87`.

## Ownership

- Message lifecycle and serialized persistence: `features/chat/useConversation.ts`.
- Message rendering and editors: `features/chat/ChatPanel.tsx`.
- Conversation navigation and options: `app/Sidebar.tsx`.
- Workspace composition: `app/useWorkspace.ts`, `app/App.tsx`.
- Attachments rail: `features/presence/PresencePanel.tsx`.
- IPC and native events: `services/desktop.ts`; native commands: `src-tauri/src/main.rs`.
- Atomic conversation storage: `src-tauri/src/history.rs`.

Delete currently uses a confirmation dialog. R005 preserves this behavior and
adds no confirmation of its own.

## Milestones and design traceability

| Milestone | Owners | Screens and controls |
| --- | --- | --- |
| Setup | This record; `mir-ui-design-R005.html` | Cumulative R002–R005, copied without rewriting embedded data |
| Message actions | `domain/messageActions.ts`, `features/chat/useConversation.ts`, `ChatPanel.tsx`, `style.css` | CHAT-02/03/04/05/06/07/09/12/13; Copy message, Edit message, Regenerate response, Copy response, Edit response, inline Cancel and Save controls |
| Conversation menu | `app/Sidebar.tsx`, `ConversationMenu.tsx` | CHAT-17, SERVER-01, DIALOG-02 and all conversation rows; conversation-options and existing Delete controls |
| Export | `domain/conversationExport.ts`, `services/desktop.ts`, native `files.rs` and `main.rs` | CHAT-17 Export chat and Export with reasoning |
| Import | Native `conversation_import.rs`, `domain/conversationImport.ts`, `useConversation.ts`, `StorageFeedback.tsx`, `Sidebar.tsx` | Every Import control; CHAT-18 technical details and Choose another file |
| Attachment backend | Native `attachments.rs`, `history.rs`, `main.rs`, typed desktop service | CHAT-02–16 attachment extraction, original storage, download and removal contracts |
| Attachment UI | `features/attachments/`, `useContextEstimate.ts`, `ContextCounter.tsx`, `PresencePanel.tsx`, `domain/attachments.ts`, native `tokens.rs` | CHAT-02/03/10/15/16 and corresponding rail states in CHAT-04/05/06/07/09/12/13; choose-files, download, remove and native drag states |
| Hardening | Focus, queue draining, token estimate lifecycle, regression/layout tests, design recipes, guide | Keyboard focus restoration, long content, empty stopped responses, failed replacements, import during generation, all 46 dossier screens at three widths |

Design `data-control-id` values remain dossier traceability only; they were not
added to product markup. Fixture markup, frozen canvases, embedded PNGs and the
dossier viewer were not copied into the application.

## Verification

The final verification commands are:

```sh
bash mir/tests/run.sh common
bash mir/tests/run.sh linux
bash mir/tests/run.sh desktop
bash mir/tests/run.sh native
cargo clippy --locked --manifest-path mir/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
bash mir/sh/build-install.sh --check
bash -n mir/sh/install.sh
shellcheck -x -P mir -P SCRIPTDIR mir/sh/install.sh
```

Local Cargo commands reused the existing build target cache through
`CARGO_TARGET_DIR`. Native checks used software rendering and the fake local HTTP
server with temporary HOME/XDG directories. No real models, GPUs, inference,
personal configuration or local system package installation were used.

Final automated counts: 40 frontend unit tests, 21 Rust unit tests and 12 Rust
integration tests, and 106 Chromium/WebKit browser tests. Desktop verification
includes Prettier, ESLint, TypeScript/Vite, cargo fmt and no-default-feature Clippy.
The additional default-feature Clippy check covers desktop command handlers.
The native smoke test exercises real Tauri/WebKit, embedded resources, IPC,
original-file survival/download, import/export commands, attachment/menu rendering,
streaming, storage, process ownership, cancellation, restart and confirmed close.

All 46 dossier screens were rendered in Proposal mode and through actual React
interactions at 960×720, 1200×820 and 1440×900. All 138 application states kept
Import visible and avoided horizontal page overflow. Direct comparisons covered
the changed chat screens; keyboard and reduced-motion tests cover long filenames,
long messages, visible focus and editor buttons. File extension colours have
contrast ratios of 6.57:1–7.74:1 against the row surface. Generated screenshots and
logs remain outside committed source.

## Dependencies

- `@tauri-apps/plugin-dialog` / `tauri-plugin-dialog` 2.8.4: native file dialogs;
  the Rust dependency is optional with the desktop feature.
- `zip` 8.6, with default features disabled and Deflate enabled: Office package
  reading and generated fixture ZIPs.
- `quick-xml` 0.41: ordered Word and PowerPoint text extraction.
- `calamine` 0.36.1: Excel sheet/row extraction. The direct ZIP/XML versions match
  its dependencies to avoid redundant parser versions.

These are all pre-approved dependencies. Package and Cargo lockfiles record the
resolved versions. No extra direct dependency was added.

## Proposal interpretation and remaining verification

- The owner approved the desktop commit as the branch base instead of `main`.
- Existing Delete confirmation is preserved. No new confirmation was introduced.
- Compact rail defaults and persisted preferences follow the real product rather
  than the dossier's frozen expanded panel. Users can expand it to reach files;
  Import and Export remain in the sidebar.
- The menu uses viewport positioning to avoid clipping inside the scrollable or
  collapsed sidebar. Its content and keyboard behavior follow the proposal.
- File extensions are written with their leading dot rather than uppercase family
  abbreviations. File icons, text and approved colours identify each type.
- Native file mutations are serialized; controls wait for extraction/storage to
  finish. Failed reads remain session feedback and are not stored as attachments.
- Actual values, filenames, errors and capability choices come from services;
  static dossier fixture values are not application defaults.
- Editor notes follow the owner's locked replacement/truncation decisions. Long
  editors scroll within messages to keep their actions reachable.
- Token counts remain estimates when native tokenization or template rendering is
  unavailable. Unknown context capacity is not guessed; server errors remain
  explicit. No attachment text is silently truncated.
- OS file-dialog interaction is not automated by the WebDriver harness and still
  needs a manual Linux/macOS check. Native commands and dialog capability setup
  are built and tested; browser fixtures exercise dialog cancellation and errors.

macOS CI passed the full attachment UI milestone, including the native window.
An earlier Linux CI run hit the pre-existing renderer visibility timing assertion
(`result.before` was zero); that renderer and its test were left unchanged.
The final commit's Linux/macOS workflow outcome is reported with the delivery.

## Cleanup and preservation

Removed obsolete Copy and hover-delete CSS, avoided the withdrawn export dialog
and rail type chips, fixed stale smoke-test selectors, removed redundant import
locking and eager alias validation, and shared request/attachment composition at
the domain boundary. Editor focus, reduced-motion scrolling, queue draining and
server-run token estimate invalidation were checked. New extraction dependencies
are used by their owning module; no unused dependency was found.

The supplied R005 dossier, its embedded baseline references and the original
`mir/docs/design/mir-ui-design.html` remain unchanged. No tags, releases,
deployment, main-branch merge or pull request were created.

Final cross-platform validation also identified a test assumption: bare Tab
skips buttons under the macOS WebKit keyboard-navigation default. The R005
keyboard tests now use the platform's Option-Tab sequence on that engine, retain
the same focus assertions, and change no application or user preference.
The supplied HTML's existing trailing whitespace was preserved with its exact
bytes; implementation files pass `git diff --check` independently of that dossier.

A final import boundary test reproduced UTF-16 surrogate splitting in long
emoji-containing derived titles. Title derivation now truncates by Unicode code
point, so valid imported content cannot become an invalid native storage string.

Export filename truncation also uses a UTF-8 byte budget, preserving complete
Unicode characters while leaving room for `.json` within filesystem name limits.

After the platform traversal correction, all R005 keyboard checks passed on
macOS CI. That run encountered a separate existing renderer still-paint timing
assertion; the renderer was left unchanged and the final workflow was rerun on
the final source revision.

Successful file operations preserve a prior history-loading error until loading
actually recovers. A dedicated import/history regression verifies that a valid
new conversation does not hide unavailable history or overwrite its files.
