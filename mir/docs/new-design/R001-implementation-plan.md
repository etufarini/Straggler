# R001 implementation plan: Projects

Date: 2026-11-12. Status: investigation and owner clarifications complete;
application implementation is waiting for the owner's go-ahead.

## Files to change or create

### Authority and working branch

- Work only on `feature/projects-r001`, created from
  `feature/r005-chat-actions-attachments-export-import` at
  `e84469ae9a3d80523f87267dea2c8807bc24a32f`.
- The dossier reference, `abbf9c76f8cf557309d2615a67b41f44250510b1`, is an
  ancestor of that base. The working tree was clean after recreating the branch.
- Compare changes and commits with
  `feature/r005-chat-actions-attachments-export-import`, never with `main`.
  Do not merge, rebase, amend existing commits, push, tag or publish.
- Follow the root `AGENTS.md`, desktop README and guide. R001's design authority
  is `mir-ui-design.html`: `projects-r001`, `contracts`, `architecture`, the 12
  specifications, R001 metadata, proposal templates/states, styles and prototype
  behavior. The owner has approved D1–D3 and A1–A8 with the stated defaults.
- The dossier and earlier local evidence are ignored artifacts. Do not clean,
  delete or commit them. Explicitly add only this requested plan from the ignored
  directory. At implementation completion, make only the requested local
  OWNER-003 additions to the dossier's `ownerDecisions` metadata and register
  table, dated 2026-11-12, without changing any other dossier bytes. Do not change
  revision statuses, reference evidence, templates, runtime or style blocks.
- R001-C07 describes existing dossier tooling. It does not authorize shipping the
  prototype runtime or changing the dossier viewer.

### Production owners

Paths below are relative to `mir/desktop/` unless otherwise stated.

| Files                                                                                                                   | Change and owning boundary                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/types.ts`; new `src/domain/projects.ts`                                                                     | Add optional conversation membership/own prompt fields and typed project, file and mutation results. Centralize project name/description validation and read-only/membership rules; preserve existing request option types.     |
| New `src/domain/projectContext.ts`                                                                                      | Single shared owner for project prompt resolution, stable request assembly, project estimation fallback, reserve and capacity thresholds. Used by chat and project views.                                                       |
| New `src-tauri/src/projects.rs`                                                                                         | Native project storage, validation, extracted text copies, archive/restore, membership coordination, deletion and recoverable file/multi-record operations. Reuse the existing extractor and atomic history patterns.           |
| `src-tauri/src/history.rs`                                                                                              | Defaulted optional fields, old-record compatibility, membership updates that preserve message/attachment/options data, coordination with project deletion. No replacement history format or load-time rewrite.                  |
| `src-tauri/src/lib.rs`, `src-tauri/src/main.rs`                                                                         | Initialize the project store under the existing data root; expose thin commands, using blocking workers for filesystem/extraction work. Coordinate mutations at the native boundary.                                            |
| `src/services/desktop.ts`, `src/services/fixtures.ts`                                                                   | Sole typed IPC access, project service operations and development-only fixtures. Reuse native chooser, extraction and token services. Match fixtures to real native serialization and errors.                                   |
| New `src/features/projects/useProjects.ts`                                                                              | Load projects, serialize mutations, expose explicit load/save failures and retry, count context by current server run, and flush outstanding work on close. Keep saved project state distinct from form/editor drafts.          |
| New `src/features/projects/ProjectsPage.tsx`                                                                            | Active/Archived tabs, search, sort, cards, starred state, empty and no-result states.                                                                                                                                           |
| New `src/features/projects/ProjectDetail.tsx`                                                                           | Project composer, chat list using the existing conversation menu, instructions panel, file inclusion/removal, context meter and recovery.                                                                                       |
| New `src/features/projects/ProjectDialogs.tsx`                                                                          | Create/edit, move listbox, instructions panel and archive/delete composition. Reuse the existing confirmation and panel patterns. Keep scope and effects explicit.                                                              |
| `src/app/App.tsx`, `src/app/useWorkspace.ts`                                                                            | Add main-view navigation for projects while retaining model/server controls and independent settings/modal state. Include project saves in close handling. Extend focus containment for all new input/select/checkbox controls. |
| `src/app/Sidebar.tsx`, `src/app/ConversationMenu.tsx`                                                                   | Projects block, project subtitles on all member chats, move/remove items, menu positioning based on actual size, existing keyboard behavior and focus return.                                                                   |
| `src/app/ConfirmationDialog.tsx`; `src/components/Popover.tsx`, `Feedback.tsx`, `FieldError.tsx` as needed              | Support the deletion checkbox without duplicating confirmation behavior; ensure new editors contain focus; preserve existing process-confirmation semantics. Allow the over-limit transition to be announced once.              |
| `src/features/chat/useConversation.ts`, `ChatPanel.tsx`, `SystemPromptMenu.tsx`, `useContextEstimate.ts`                | Shared project request policy for send, edit/regenerate and draft estimation; own-prompt preservation; breadcrumb and project chip/editor; read-only and over-limit explanations. Keep one conversation lifecycle/save queue.   |
| `src/features/attachments/AttachmentSection.tsx`, `useAttachments.ts`; new `src/features/attachments/AttachmentRow.tsx` | Extract the existing file row for reuse by both owners, retaining chat download/progress/error behavior. Route native drops to the visible owner so project drops cannot attach to a hidden chat.                               |
| `src/style.css`                                                                                                         | Adapt R001 layout to existing tokens/classes. Reuse shared classes, remove prototype-specific prefixes, and preserve unchanged screens.                                                                                         |
| `runtime-files.txt`                                                                                                     | Enumerate all added production modules so source and installed preparation bundle the same code.                                                                                                                                |
| `mir/sh/install.sh` (generated)                                                                                         | Regenerate with `mir/sh/build-install.sh` after manifest changes; its embedded extraction list includes the manifest entries. Keep the canonical release tag unchanged.                                                         |
| `mir/docs/guide.md`, `mir/desktop/README.md`                                                                            | Document project behavior, storage, defaults, commands and limits in M6. Keep README quick-start scope and stable release references intact.                                                                                    |

Keep `src/domain/attachments.ts`, `src/domain/chat.ts`, reasoning controls,
`ContextCounter.tsx` and the native tokenizer/model-discovery contracts as the
existing outside-project owners. Only make focused compatibility changes there
when sharing the new policy requires them. Extend `src/domain/conversationExport.ts`
to resolve the current effective project prompt, as settled in Q3 below. Import
continues to create a new outside-project conversation. Extend native chat error
handling and the existing chat error region only as needed for Q1's pinned
over-context response and its recovery actions.

No dependency additions are planned. `attachments::extract` already supports all
six required file types, including PDF. No retrieval, embeddings, images, bulk
move, direct project import, project transfer format or configuration association
will be introduced.

### Screen and stable control map

Existing selectors remain intact. Tests use semantic roles/labels today; new
controls also receive the exact `data-control-id` values from the dossier.
Dynamic suffixes below represent the dossier's fixture name/title slugs, not
filesystem identifiers. UUIDs remain the data identity, even for duplicate chat
titles or filenames that produce the same display slug.

| Screen                                 | Owner                                                      | R001 controls                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CHAT-01, CHAT-02, all sidebar contexts | `Sidebar.tsx`                                              | `button-new-project`, `button-project-<name>`, `button-all-projects`; preserve `button-new-chat`, import, chat/options and Settings controls. Add the member project's name and archived state under conversation titles. New chat stays outside projects.                                                                                                                                      |
| CHAT-17                                | `ConversationMenu.tsx`                                     | `button-move-to-project`, `button-remove-from-project`; retain export/export-with-reasoning/delete IDs. Project chats use “Move to another project…”.                                                                                                                                                                                                                                           |
| PROJ-01                                | `ProjectsPage.tsx` and shared project menu                 | `button-new-project-page`, `tab-active-projects`, `tab-archived-projects`, `input-search-projects`, `select-sort-projects`, `button-open-project-<name>`, `button-star-<name>`, `button-options-for-project-<name>`, `button-clear-search`.                                                                                                                                                     |
| PROJ-02                                | `ProjectsPage.tsx`                                         | `button-create-first-project`; keep the sidebar's explanation and New action.                                                                                                                                                                                                                                                                                                                   |
| PROJ-03                                | `ProjectDetail.tsx` and existing conversation menu         | `button-back-to-projects`, `button-star-current-project`, `button-options-for-current-project`, `textarea-start-chat`, `button-start-chat`, `button-open-<chat-title>`, `button-options-in-project-<chat-title>`, `button-edit-instructions`, `button-add-project-files`, `meter-project-context`, `switch-include-<filename>`, `button-remove-file-<filename>`, `button-choose-project-files`. |
| PROJ-04                                | `ProjectDialogs.tsx`                                       | `input-project-name`, `textarea-project-description`, `button-cancel`, `button-create-project`; editing uses `button-save-project-details`. Name validation and description counter remain associated with their fields.                                                                                                                                                                        |
| PROJ-05                                | `ProjectDetail.tsx`, shared context policy and chat guards | All PROJ-03 controls plus `button-review-files`, `button-change-context-size`. Preserve draft and focus the Files heading on Review files. Display the token shortfall explicitly.                                                                                                                                                                                                              |
| CHAT-20                                | `ProjectDialogs.tsx`, `useConversation.ts`                 | `input-find-project`, `option-project-<name>`, `button-cancel`, `button-confirm-move`; no-active-project recovery uses `button-new-project-for-chat`. Current project stays visible but unselectable.                                                                                                                                                                                           |
| CHAT-21                                | `ChatPanel.tsx`, `SystemPromptMenu.tsx`, project editor    | `button-crumb-project`, existing `button-system-prompt`, `button-close-project-instructions`, `textarea-project-instructions`, `button-open-project-from-prompt`, `button-save-instructions-for-chats`. Save names the number of affected chats.                                                                                                                                                |
| DIALOG-07                              | `ProjectDialogs.tsx`, `ConfirmationDialog.tsx`             | `checkbox-also-delete-chats`, `button-cancel`, `button-delete-project`. Default is keep chats; destructive label changes when deleting chats too.                                                                                                                                                                                                                                               |
| DIALOG-08                              | `ProjectDialogs.tsx`, shared confirmation                  | `button-cancel`, `button-archive-project`; Restore controls are `button-restore-project`, `button-restore-project-menu`, `button-restore-from-chat`.                                                                                                                                                                                                                                            |

Additional controls exposed by the behavior reference: project menus use
`button-star-project-menu`, `button-edit-project-details`,
`button-archive-project-menu`, `button-delete-project-menu`; the detail
instructions panel uses `button-close-panel`, `textarea-edit-project-instructions`,
`button-save-instructions`, `button-cancel`. Feedback uses `button-undo` and
`button-dismiss-message`. Native file selection stays native; the prototype's
hidden HTML file input is not a production replacement.

Archive, restore, move/remove and file removal offer the prototype's Undo
behavior. Project deletion is permanent after its explicit confirmation; the
prototype does not offer Undo for deletion. Do not copy its whole-state snapshot
Undo: reverse only the affected operation, preserving later messages/edits and
reporting a conflicting or failed reversal.

## Data model and storage format

### Existing history and compatibility

Current records are `desktop/conversations/<UUID>.json`, with `id`, `title`,
`createdAt`, `updatedAt`, `model`, `messages`, optional `attachments` and optional
`options`. `options.systemPrompt` is already the own prompt: missing/null inherits
applied Settings; an explicit empty string means no system message. Reasoning and
effort inherit independently. Rust deserialization denies unknown fields and
validates UUIDs. Loading marks interrupted streams in memory without rewriting
the record. Writes hold a native mutex and use a same-directory temporary file,
flush/sync and atomic persist. The frontend also serializes save snapshots.

Add optional `projectId` and `ownSystemPrompt` to the existing conversation record.
An absent project means an ordinary conversation. For existing records, resolve
the own prompt from `options.systemPrompt` without a migration. An absent/null own
prompt inherits applied Settings; `""` remains explicitly empty. When a chat first
moves into a project, capture its own prompt without altering its options,
messages, attachments, reasoning or effort. Keep it on project-to-project moves
and restore its meaning on removal or keep-chats deletion. Resolve through one
helper; avoid competing prompt sources in UI components. No history is rewritten
just because it was read or R001 was installed.

### Project records

Use the existing XDG data root, never browser storage or profiles:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/mir.cpp/desktop/
  projects/<project-uuid>/project.json
  projects/<project-uuid>/files/<file-uuid>.txt
  conversations/<conversation-uuid>.json          # existing location
  conversations/<conversation-uuid>/attachments/ # existing originals
```

`project.json` contains `id`, `name`, `description`, `instructions`, `starred`,
`archived`, `createdAt`, `updatedAt` and an ordered `files` metadata array. Each
file records its UUID, original display name, extension/type, source byte size,
inclusion state and token count with its source. Include the counting server run
identity so persisted counts from another run are never presented as current
server counts. The IPC model can return extracted text with metadata after native
validation; text belongs in its separate UTF-8 file on disk, not a user path.

Persist file order explicitly as array order. Preserve selection order when
extraction completes asynchronously. Display sorting must not reorder requests.
New files are included by default. Reuse the extractor's six supported types,
10 MiB maximum and explicit unsupported/unreadable/encrypted/no-text errors.
Project storage retains extracted text copies only; original files are read,
never modified, renamed or removed.

Validate name required/trimmed/maximum 80 characters and case-insensitive
uniqueness across active and archived projects, excluding the edited record.
Description is optional, maximum 200 characters with a live counter. Enforce
validation natively as well as in forms. Use UUID path components, reject mismatched
record/path identities and never form storage paths from names or caller-supplied
relative paths. Apply the existing private directory/file and atomic-write rules.

### Mutation and failure guarantees

- Extend `useConversation`'s existing serialized-save mechanism (`saveQueue`,
  `flushSaves` and the mutation boundary) to cover every project and conversation
  write. Scope request-related guards to the affected chat/project, following Q2;
  the existing global mutation guard cannot simply block every project edit.
  Do not let a queued old snapshot restore a removed membership, overwrite a newly
  moved chat or lose partial response saves.
- Project file addition writes the text copy before atomically publishing its
  metadata. Failed metadata persistence preserves the previous project and
  reports cleanup failures. Removal publishes metadata safely before reclaiming
  the copy; retain the affected copy while its offered Undo remains usable.
- Multi-record keep-chats/delete-chats operations require native coordination,
  consistent lock order and recoverable staging/journaling. Validate all targets
  and save recovery information before changing visible records. Detach or delete
  member chats successfully before removing the project. Recover interrupted
  operations before returning usable project/history lists; never silently clear
  a dangling membership or fall back to sending a different prompt.
- Undo for archive/restore, move/remove and file removal is an inverse operation
  against affected objects, with validation and serialized persistence. The
  prototype's feedback lasts eight seconds; retain only the data necessary for
  that reversal, then reclaim unused staged copies safely.
- Archive is enforced at mutation/request boundaries, not just by disabled
  controls. Archived chats remain readable/exportable. Starting/sending,
  edit/regenerate, instructions/files, membership and destructive changes must
  respect read-only state; Restore is available and deletion requires Restore.
  Extend `src-tauri/src/chat.rs` (`Runtime::generate`) and the request model in
  `src-tauri/src/lib.rs` with the identity needed to verify member-chat archive
  state, alongside the shared frontend preflight. Ordinary requests remain
  compatible when the optional identity is absent.
- Loading/saving errors stay explicit with retry. Failed saves keep edits and the
  last saved state. Closing includes project work in the existing cancellation,
  save and owned-process cleanup flow. Do not introduce another storage queue
  that close cannot flush.

## Request assembly

`projectContext.ts` owns the project policy and pure assembly helpers; asynchronous
tokenization uses the typed desktop service. Both project views and chat call the
same helpers.

1. Resolve reasoning and effort through the existing chat options rule.
2. Outside projects, preserve the current request path exactly, including explicit
   empty own prompts and conversation attachments in the first user message.
3. Inside a project, choose nonempty project instructions; otherwise use the
   **applied** Settings prompt. Ignore the stored own prompt for this request while
   retaining it unchanged for removal. Never use edited Settings drafts.
4. Build one stable system message: effective instructions first, then included
   project files in persisted insertion order. Reuse the existing filename-quoted
   BEGIN/END text delimiter construction. Excluded files contribute nothing.
   Do not place changing timestamps, counters or conversation text in this prefix.
5. Append the conversation through the existing request message filter; retain
   chat attachments at their existing first-user-turn boundary. Preserve raw
   stored text, partial/interrupted responses and existing edit/regenerate rules.
6. Count the exact prefix used for the meter and the full assembled request used
   for sending. Server text tokenization is already `tokenize_text` (`/tokenize`);
   full request counting is `prompt_tokens` (`/apply-template`, then `/tokenize`).
   Existing native code rechecks run identity. Recount after content, inclusion,
   applied fallback prompt or server-run changes, discarding stale async results.
7. A fresh pre-send check uses the same assembly for Send, Start chat,
   regenerate and user edit/regenerate. Block project-prefix overflow and retain
   the existing full-request-versus-window guard. Do not clear drafts or save a
   new user turn before validation succeeds. Never truncate a project file.
8. Capture the complete request as an immutable snapshot before dispatch. Never
   re-read project instructions or file text mid-stream. Q2's permitted edits
   change the next request only; filesystem reclamation cannot affect in-flight
   content. Q1's server rejection preserves/restores the user's draft and shows
   both recovery actions through the existing chat error pattern.

Keep owner defaults in one named location each, in `projectContext.ts`:

| Named policy                       | Default                                                                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectConversationReserve(nCtx)` | 25% of the current window, rounded up to whole tokens; 4,096 at 16,384. Available space is window minus reserve.                                                                                                           |
| `projectContextThresholds`         | Close from 75% of available space; over only above 100%. Compare the actual ratio, not its displayed rounded percentage. Exactly 100% fits the project-prefix rule.                                                        |
| `estimateProjectTokens(text)`      | Approximately four characters per token, rounded up, with zero for empty text; use when the server tokenizer is unavailable. Mark approximations with `≈`. Preserve the existing outside-project UTF-8-byte approximation. |

The authoritative `n_ctx` is the running server's
`default_generation_settings.n_ctx` via `ServerDetails.contextSize`, scoped to
`runId`. Do not substitute training context, an unapplied draft, a fixture value
or a previous run's telemetry. When this value is unknown, allow sending and show
“Capacity unavailable” with the reason, without a numeric capacity or percentage.
Counts may still be shown with `≈` for estimates. Apply the capacity rule as soon
as a current value arrives, as settled in Q1.
Tokenizer unavailability alone switches counting source; it never disables
server controls. Do not treat a stored server count as current when its model/run
has changed. The instructions editor retains its approximate editing counter.

The meter includes the actual fallback Settings prompt and filename delimiters.
The prototype adds preassigned file counts and omits delimiter tokenization, so
production counts may differ. Keep fixture numbers as simulated evidence, and
document this justified numerical difference during visual comparison.

## Milestones

Each step is a separate concern, builds before committing and uses an imperative
subject of at most 72 characters prefixed `M1:` through `M6:`. Record the complete
milestone checks in its last commit body. If the same failure resists two attempts,
stop and report the attempts rather than weakening a check.

| Milestone                          | Small commit sequence and exit condition                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1 · Domain and storage            | Add typed models/name validation and compatibility tests; add native store with atomic project/file operations; add coordinated membership/deletion and recovery tests; wire thin IPC and matching fixtures. Register new runtime sources as they are added. Native and fixture contracts agree, and old history loads byte-for-byte unchanged.                          |
| M2 · Chat integration              | Add and test `projectContext.ts`; preserve/resolve own prompts and membership through the existing conversation save queue; wire fresh preflight and debounced estimation for all request entry points. Project limits and archive policy cannot be bypassed by regenerate. Apply the owner answers Q1–Q3, including the request snapshot and server rejection recovery. |
| M3 · Sidebar and conversation menu | Add project navigation/sidebar; extend the existing menu and move/remove dialog with Undo; add breadcrumb and project instructions chip/editor. Deliver CHAT-01/02/17/20/21 using real controllers.                                                                                                                                                                      |
| M4 · Projects page and detail      | Add list/empty/search/sort/tabs and create/edit dialog; add project composer/chat list/instructions panel; reuse file rows with inclusion and meter; add over-limit recovery. Deliver PROJ-01…05.                                                                                                                                                                        |
| M5 · Archive and delete            | Connect confirmations and deletion checkbox to verified native operations; add read-only archived views, Restore and operation-specific Undo feedback. Deliver DIALOG-07/08 and keep-chats/default prompt restoration.                                                                                                                                                   |
| M6 · Polish                        | Finish responsive and accessibility checks, run visual comparisons and regressions, update practical documentation, perform a fresh reviewer pass and scoped cleanup. Finally add only OWNER-003's two local dossier records.                                                                                                                                            |

Native primitives precede UI wiring, so M1 can test archive/deletion contracts
before M5 exposes those flows. Shared row/focus changes belong to their first
consumer's small commit, not a formatting or unrelated refactoring commit.

## Tests per milestone

### Existing tooling and baseline

Run npm commands from `mir/desktop`; run `bash mir/tests/run.sh ...` from the root.
The desktop runner executes formatting, lint, build, Rust format/Clippy, Vitest,
native runtime contracts and Chromium/WebKit scenarios. Native window tests are
separate. All runtime fixtures use temporary user directories, fake executables
and local HTTP servers. No system package installation, GPU, model or inference
service is required.

Investigation checks on the untouched desktop base:

- `git merge-base --is-ancestor abbf9c76f8cf557309d2615a67b41f44250510b1 HEAD`:
  passed.
- `git status --short --untracked-files=all`: clean after branch recreation.
- `npm run typecheck`: passed.
- `npm test`: passed, 9 files / 40 tests.
- Playwright Chromium rendered all 12 dossier Proposal screens through the viewer
  at 1200 × 820, unscaled, with zero page errors. Screenshots are under
  `mir/desktop/test-results/design/r001-plan/<SCREEN>-proposal-1200x820.png`;
  `reference-checks.json` records dimensions and results. PROJ-01, PROJ-03,
  PROJ-05 and CHAT-21 were visually inspected.

No full desktop/native suite or macOS/CI check was run for this documentation-only
planning step. No application behavior has changed. Record any baseline failures
separately when the complete suites run during implementation.

### M1

- New `tests/projects.test.ts` and Rust `projects.rs` tests: required name,
  80-character boundary, case-insensitive uniqueness including archived projects,
  self-rename, optional/200-character description and UUID/path validation.
- Extend `history.rs` tests with real pre-R001 records, inherited and explicitly
  empty prompts, attachment-only histories and interrupted responses. Assert load
  leaves original JSON bytes and originals unchanged.
- Exercise atomic create/update, storage failure, extraction failure, inclusion
  persistence, native mutation serialization, interrupted multi-record recovery
  and failure rollback. Delete with keep chats and with delete chats; prove own
  prompt, attachments and unrelated records survive where required.
- Extend `src-tauri/tests/desktop.rs` for real Runtime/IPC models in isolated data
  roots, and `tests/contracts.test.ts`/fixture assertions against actual native
  serialization. Reuse pinned local `/props`, `/tokenize`, `/apply-template`
  contracts in `tests/fixtures/server.py`; do not invent a fixture-only schema.
- Checks: targeted Vitest and Rust tests, typecheck/lint/format, build,
  `bash mir/tests/run.sh desktop`; manifest/architecture checks as below.

### M2

- New `tests/project-context.test.ts`: prompt fallback including whitespace-empty
  instructions, full included text, stable order and quoted filename delimiters,
  excluded files, stable prefix across turns and chat attachment coexistence.
- Capacity tests: reserve, 75% boundary, just below/at/above 100%, rounded display
  versus actual comparison, counted/estimated sources, unavailable capacity per
  Q1, server-run changes and full-request overflow with an otherwise fitting
  project. No stale tokenizer result may enable Send.
- Move/remove round trips for inherited, custom and explicitly empty own prompts;
  project-to-project moves; preserve reasoning/effort and options.
- Browser/local native scenarios: fresh preflight, retained draft on block,
  regenerate/edit entry points, tokenizer failure, shared instructions across
  chats, partial/failed/interrupted response saving and storage retry.
- Add a pinned local HTTP fixture with missing `n_ctx` and the verified HTTP 400
  over-context JSON error even when `stream: true` is requested. Verify complete
  untruncated submission, retained/restored draft, existing chat error region and
  both recovery actions, followed by normal blocking when capacity becomes known.
- Prove the immutable request snapshot: change instructions, add/remove files and
  toggle inclusion during a response; its submitted payload stays unchanged and
  the next request sees the saved changes. Verify serialized partial/project saves.
- Export with and without reasoning uses current project instructions or applied
  Settings fallback; after removal it uses the stored own prompt again. Changing
  instructions before export follows existing current-prompt export semantics.
  Assert there are no added export fields, project name, files or stored own prompt.
- Regress existing chat, attachments, message-action and import/export suites.
- Checks: domain suites, targeted Playwright, runtime tests and full desktop suite.

### M3

- Extend `tests/e2e/conversation-menu.spec.ts`; add
  `tests/e2e/projects.spec.ts` and fixture setup for all R001 screens.
- Cover outside-project sidebar New chat, starred project access and subtitles,
  move search/listbox navigation, disabled current destination, own-prompt
  warning (including explicit empty), target-named confirmation, no-active-project
  creation, remove and Undo, and persisted membership after reload.
- Cover breadcrumb and shared prompt editor wording, affected-chat count,
  Settings fallback, stored own prompt and native failure feedback.
- Keyboard: Arrow/Home/End menu traversal, Escape/focus return, dialog containment
  including input fields, listbox arrows and no action hidden below the viewport.
- During generation, generating-chat move/remove and its project archive/delete
  stay visible but disabled with the reason; other member chat mutations remain
  available. Shared content editing shows “Changes apply from the next message.”
- Checks: targeted Playwright in Chromium/WebKit, existing menu/import/export and
  chat regressions, full desktop suite at milestone completion.

### M4

- Cover create/duplicate/required/max-length validation and descriptions;
  edit details, star, search, Clear search, recent/name sort and tab arrow keys.
- Include/exclude a file to cross each threshold and overflow; show `≈` with
  tokenizer unavailable. Review files moves focus; Change context size opens
  Model settings for review without changing/applying/restarting automatically.
- Start chat uses project membership on its first saved turn and sends the stable
  prefix. Native drop/chooser goes to the visible project, never a hidden chat.
- Reading/error rows, unsupported files, unchanged originals, removal and Undo,
  file inclusion after reload, rapid toggles and save/extraction failures.
- Assert over-limit transition alert fires once, state has text, meter values are
  accessible and draft survives recovery. Unknown capacity follows Q1.
- Checks: project/domain/runtime suites, targeted Chromium/WebKit flows, full
  desktop suite and updated manifest/architecture checks.

### M5

- Archive confirmation, disappearance from active/sidebar lists, readable chats,
  disabled mutations/send/edit/regenerate, all Restore entry points and Undo.
- Delete an active project with keep-chats default and with chat deletion enabled;
  assert exact action labels, returned own prompts and unchanged source files.
  Archived deletion stays blocked until Restore.
- Failure cases: unsaved chat, queued saves versus membership, atomic operation
  failure/recovery, Undo persistence failure and stale inverse operation. Confirm
  a process shutdown dialog still uses separate SIGTERM/SIGKILL approvals.
- Checks: native storage/runtime suites, targeted project and lifecycle browser
  flows, full desktop suite; real native window smoke coverage on available host.

### M6 and final evidence

- Update `tests/design-scenarios.mjs` and `tests/design-review.mjs` for every R001
  screen. The existing harness points to the obsolete `new_design/` directory and
  static `setContent` omits the R001 runtime. Render the dossier's actual viewer
  for reference screenshots, selecting Proposal at 1200 × 820; never modify the
  dossier to accommodate the harness.
- Capture actual React and Proposal pairs for all 12 screens. List differences;
  fix unjustified differences. Retain the live assistant rail in chat: its absence
  from prototype thread screens is an explicit dossier limitation. Report actual
  counting/delimiter differences honestly.
- Check 760 × 560, 960 × 720 and 1440 × 900 for overflow, scrolling, keyboard
  reachability and dialog/menu/panel fit. Recheck unchanged screens, six Settings
  sections, Modified/Restart state, and model/server controls.
- Accessibility: visible focus, focus containment/return and Escape; arrows in
  tabs/listboxes/menus; field errors via `aria-invalid`/`aria-describedby`;
  progress as status, failures as alert, one transition announcement per overflow;
  no state conveyed by color alone and no visible text below the 11px floor.
- Run `bash mir/tests/run.sh desktop` and pertinent common/platform suites. For
  runtime manifest changes run `bash mir/tests/architecture.sh`,
  `bash mir/sh/build-install.sh --check` and installation fixtures; regenerate the
  installer when adding runtime manifest entries changes its embedded file list.
  Any shell changes
  require syntax and ShellCheck. Preserve the stable tag value.
- Run `bash mir/tests/run.sh native` on the available host, with the existing
  isolated local server and actual native storage/window smoke assertions.
  Linux and macOS CPU CI/native-window results are required evidence; if no
  authorized CI execution/macOS runner is available without pushing, report that
  limitation and pending check explicitly. Never claim both targets were tested
  from a single Linux browser run.
- Fresh reviewer pass against the full base-relative diff and all R001 criteria.
  Fix correctness/requirement gaps, review changed dependencies for redundant or
  unused content, and report scoped cleanup. No tests for documentation-only edits.
- Verify the final dossier diff changes only the two OWNER-003 records. Leave
  that ignored artifact and all screenshots uncommitted. Report changed file/control
  mapping, format, commands/results, screenshot paths, defaults, deviations,
  limitations and `git log --oneline feature/r005-chat-actions-attachments-export-import..HEAD`.

## Risks

1. **Save races and cross-record deletion.** The current frontend serializes
   conversation snapshots, but new independent project saves would not by
   themselves protect membership. Use coordinated native operations and flush
   existing queues; test interruption and storage failures before wiring UI.
2. **Legacy prompt semantics.** Missing/null and explicit empty differ. Retaining
   both legacy options and the optional own prompt requires one resolution rule
   with round-trip tests; do not normalize an empty prompt into inheritance.
3. **Stale counts and unknown capacity.** A saved token count may belong to another
   model/run. Reject stale asynchronous results, mark estimates and never use a
   fixture/draft context size as telemetry. Q1 permits unknown-capacity submission
   with explicit unavailable state and server-error recovery; test both paths.
4. **Shared edits during streaming.** A generated request has already captured its
   prefix. Q2 allows content edits for the next request but blocks operations on
   the generating chat's identity or project lifecycle. Narrow existing global
   busy guards without weakening serialized saving or immutable snapshots.
5. **Shared focus and file-drop ownership.** Existing modal focus selection omits
   input/select elements, and attachments listen to window-wide native drops.
   Extend their real owners and regress existing flows instead of duplicating
   helpers or listeners.
6. **Reference harness drift.** Correct its source path and use the running viewer;
   static markup alone cannot render R001's dynamic sections. Existing reference
   fixture token numbers are not tokenizer accuracy evidence.
7. **Installed preparation.** Missing new entries in `runtime-files.txt` could make
   source development pass while installed builds fail. Check packaging as soon
   as new modules are added, without changing release versions.
8. **Undo versus later work.** Whole-state replacement would erase later edits or
   responses. Use narrow inverse operations with conflict detection and retained
   file copies only for the offered reversal window.
9. **Platform evidence.** Native file dialogs and actual windows differ from
   Chromium/WebKit fixtures. Disclose unperformed OS dialog, macOS and CI checks;
   GPU/inference is never a substitute or a required gate.

## Questions

The owner answered all three investigation questions on 2026-11-12 before the
plan commit. These answers and the supplied numerical defaults are settled;
there are no remaining implementation-blocking product questions.

### Q1 · Unknown capacity: approved deviation note

Follow the existing non-blocking telemetry behavior documented by
[CHAT-09](mir-ui-design.html#spec-CHAT-09) and the
[missing telemetry is non-blocking contract](mir-ui-design.html#contracts):

- Unknown `n_ctx` allows sending. The meter says “Capacity unavailable” and gives
  the reason, for example “the running server has not reported its context size”.
  Do not invent a denominator or percentage. Counts may still appear, marked `≈`
  when estimated. Never truncate/drop project instructions or file text.
- An over-context server rejection uses the existing chat error region/pattern,
  preserves/restores the user's draft and offers “Review files” and
  “Change context size in Settings”. As soon as current `n_ctx` becomes known,
  apply the normal reserve/threshold/blocking rule.
- This explicitly settles R001's unknown-capacity case beyond its known-capacity
  fixture; it does not weaken blocking when the capacity is known. Include the
  deviation in the implementation report.
- The owner requires verifying the pinned server error and adding a matching
  fixture/test. If the verified input path truncates or shifts instead of rejecting
  oversized input, stop and report before proceeding. Verification below found
  the rejecting path; fixture/application changes await the implementation go-ahead.

### Q2 · Generation: approved split by impact

- While a response generates, allow instructions, file addition/removal, Include
  switches, name, description and star edits for subsequent requests. The sent
  request keeps its immutable snapshot; never reload project content mid-stream.
  Show “Changes apply from the next message.” next to Instructions and Files while
  a member chat is generating.
- Moving/removing the generating chat, and archiving/deleting its project, wait
  until the response finishes or is stopped. Keep the actions visible and disabled
  with “Available when the current response finishes or is stopped”, following
  [CHAT-03](mir-ui-design.html#spec-CHAT-03). Never silently queue these actions.
- Moving, removing or deleting other chats in that project remains allowed.
  Reuse the existing serialized-save mechanism for every project/conversation
  write. Test the snapshot and each action's disabled reason.

### Q3 · Exports: approved effective prompt, existing format

Both export actions write the project's current instructions, or applied Settings
fallback when empty, in the existing system-message field. Do not add project
metadata, the stored own prompt or project files. The format/version is unchanged.
After removal from the project, export resolves the chat's own prompt again.

Current `serializeConversation` behavior exports **one effective prompt at export
time**, regardless of earlier prompt changes; it does not retain per-turn prompt
versions. Project exports follow this same behavior when instructions changed
during the chat: use the current effective prompt, not a reconstructed historical
one. Add the round-trip membership/export test for both export actions and the
current-instructions-after-edit case. Future project metadata export is out of
scope; no new transfer format is proposed here.

### Pinned upstream verification for Q1

Inspected upstream commit `a4d4f2fd4ec85ec6a0a9ece4870416c1b6cc24f5` read-only.
The GitHub connector fetch was unavailable; direct pinned raw sources were used.

- The text completion input check rejects a prompt at or above the slot window
  before processing it; this path does not truncate or shift it. The message
  template is `request (%d tokens) exceeds the available context size (%d tokens), try increasing it`.
  The route also returns the first error as JSON before opening an SSE stream.
  See [input validation](https://github.com/ggml-org/llama.cpp/blob/a4d4f2fd4ec85ec6a0a9ece4870416c1b6cc24f5/tools/server/server-context.cpp#L3748-L3766),
  [streaming first-error handling](https://github.com/ggml-org/llama.cpp/blob/a4d4f2fd4ec85ec6a0a9ece4870416c1b6cc24f5/tools/server/server-context.cpp#L4974-L4986)
  and [HTTP error wrapping](https://github.com/ggml-org/llama.cpp/blob/a4d4f2fd4ec85ec6a0a9ece4870416c1b6cc24f5/tools/server/server-context.cpp#L4840-L4843).
- [Error mapping](https://github.com/ggml-org/llama.cpp/blob/a4d4f2fd4ec85ec6a0a9ece4870416c1b6cc24f5/tools/server/server-common.cpp#L119-L128)
  yields HTTP 400 with `error.code: 400`, `error.type: "exceed_context_size_error"`
  and the message. [Result serialization](https://github.com/ggml-org/llama.cpp/blob/a4d4f2fd4ec85ec6a0a9ece4870416c1b6cc24f5/tools/server/server-task.cpp#L1453-L1459)
  additionally provides `error.n_prompt_tokens` and `error.n_ctx`. Model these
  fields faithfully in the local Python HTTP fixture and browser/native tests.
- The server can optionally shift context during subsequent generation; that
  differs from initial over-context rejection. [The pinned server defaults](https://github.com/ggml-org/llama.cpp/blob/a4d4f2fd4ec85ec6a0a9ece4870416c1b6cc24f5/tools/server/README.md)
  disable context shift. Preserve native configuration controls; this source
  inspection is contract evidence, not a real inference test.

After this plan is committed, stop for the owner's explicit implementation
go-ahead. Additional real design decisions require an owner answer.
