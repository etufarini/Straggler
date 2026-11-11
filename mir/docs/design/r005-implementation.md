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
