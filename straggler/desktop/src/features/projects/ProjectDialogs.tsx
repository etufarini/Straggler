import { countLabel } from '../../domain/text';
import { useId, useState } from 'react';
import { Folder, Search, X } from 'lucide-react';
import type { ProjectDialog, WorkspaceController } from '../../app/useWorkspace';
import type { Project } from '../../domain/projects';
import { ownSystemPrompt, projectDescriptionError, projectNameError } from '../../domain/projects';
import { estimateProjectTokens } from '../../domain/projectContext';
import { newConversation } from '../../domain/types';
import { errorDetail } from '../../domain/errors';
import Feedback from '../../components/Feedback';
import FieldError from '../../components/FieldError';
import { controlSlug } from '../../components/ActionMenu';
import { ConfirmationFrame } from '../../app/ConfirmationDialog';

export default function ProjectDialogs({ controller }: { controller: WorkspaceController }) {
  const dialog = controller.projectDialog;
  if (!dialog) return null;
  return (
    <ProjectDialogContent
      key={`${dialog.kind}-${dialog.id ?? dialog.conversationId ?? ''}`}
      controller={controller}
      dialog={dialog}
    />
  );
}

function ProjectDialogContent({
  controller,
  dialog,
}: {
  controller: WorkspaceController;
  dialog: ProjectDialog;
}) {
  const { projects, setProjectDialog } = controller;
  const project = projects.projects.find((value) => value.id === dialog.id);
  const chat = controller.conversations.find((value) => value.id === dialog.conversationId);
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [instructions, setInstructions] = useState(project?.instructions ?? '');
  const [errors, setErrors] = useState<{ name?: string; description?: string }>({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [alsoChats, setAlsoChats] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const id = useId();
  const close = () => {
    if (!busy) setProjectDialog(null);
  };
  const members = controller.conversations.filter(
    (value) => project && value.projectId === project.id,
  );
  if (
    project &&
    controller.chat.projectId === project.id &&
    !members.some((value) => value.id === controller.chat.id)
  )
    members.push(controller.chat);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setFailure('');
    try {
      await action();
      setProjectDialog(null);
    } catch (error) {
      setFailure(errorDetail(error).message);
    } finally {
      setBusy(false);
    }
  }
  const feedback = failure ? (
    <Feedback title="The action could not be completed" details={failure}>
      Review the details before trying again. This window remains open.
    </Feedback>
  ) : null;
  const cancel = (
    <button type="button" data-control-id="button-cancel" disabled={busy} onClick={close}>
      Cancel
    </button>
  );

  if (dialog.kind === 'create' || dialog.kind === 'edit') {
    const create = dialog.kind === 'create';
    async function saveDetails() {
      const nextErrors = {
        name: projectNameError(name, projects.projects, project?.id),
        description: projectDescriptionError(description),
      };
      setErrors(nextErrors);
      if (nextErrors.name || nextErrors.description) {
        document.querySelector<HTMLInputElement>('[data-control-id="input-project-name"]')?.focus();
        return;
      }
      await perform(async () => {
        if (create) {
          const value: Project = {
            id: crypto.randomUUID(),
            name: name.trim(),
            description: description.trim(),
            instructions: '',
            starred: false,
            archived: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            files: [],
          };
          const result = await projects.create(value);
          if (chat) await controller.moveChat(chat, result.project.id);
          else
            projects.setNotice({
              message: `Created “${result.project.name}”. Add instructions and files when you are ready.`,
            });
          controller.openProject(result.project.id);
        } else if (project) {
          await projects.update(project.id, { name: name.trim(), description: description.trim() });
          projects.setNotice({ message: 'Saved the project details.' });
        }
      });
    }
    return (
      <ConfirmationFrame
        busy={busy}
        project
        role="dialog"
        title={create ? 'New project' : 'Edit project details'}
      >
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void saveDetails();
          }}
        >
          <label className="setting-field">
            <span>Name</span>
            <input
              data-initial-focus
              data-control-id="input-project-name"
              maxLength={80}
              autoComplete="off"
              value={name}
              disabled={busy}
              aria-invalid={!!errors.name}
              aria-describedby={`${id}-name-help${errors.name ? ` ${id}-name-error` : ''}`}
              onChange={(event) => {
                setName(event.target.value);
                setErrors((value) => ({ ...value, name: undefined }));
              }}
            />
            <FieldError id={`${id}-name-error`} message={errors.name} />
            <small id={`${id}-name-help`}>Up to 80 characters. Must be unique.</small>
          </label>
          <label className="setting-field">
            <span>
              Description <span className="project-optional">Optional</span>
            </span>
            <textarea
              data-control-id="textarea-project-description"
              className="settings-textarea"
              rows={3}
              maxLength={200}
              value={description}
              disabled={busy}
              aria-invalid={!!errors.description}
              aria-describedby={`${id}-description-help${errors.description ? ` ${id}-description-error` : ''}`}
              onChange={(event) => setDescription(event.target.value)}
            />
            <FieldError id={`${id}-description-error`} message={errors.description} />
            <small id={`${id}-description-help`}>
              Shown on the project card. {Array.from(description).length} / 200
            </small>
          </label>
          {create && <p className="field-help">You can add instructions and files later.</p>}
          {chat && ownSystemPrompt(chat) !== null && (
            <Feedback severity="warning" title="This chat has its own system prompt">
              In {name || 'this project'} it uses the project instructions instead. Your prompt is
              kept with the chat and returns if you remove it from the project.
            </Feedback>
          )}
          {feedback}
          <div className="panel-actions">
            {cancel}
            <button
              type="submit"
              className="primary-button"
              data-control-id={create ? 'button-create-project' : 'button-save-project-details'}
              disabled={busy}
            >
              {busy ? 'Saving…' : create ? 'Create project' : 'Save changes'}
            </button>
          </div>
        </form>
      </ConfirmationFrame>
    );
  }
  if (dialog.kind === 'move' && chat) {
    const targets = projects.projects
      .filter(
        (value) => !value.archived && value.name.toLowerCase().includes(query.trim().toLowerCase()),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const destination = targets.find(
      (value) => value.id === selected && value.id !== chat.projectId,
    );
    const options = targets.filter((value) => value.id !== chat.projectId);
    return (
      <ConfirmationFrame project role="dialog" title={`Move “${chat.title}”`}>
        {projects.projects.some((value) => !value.archived) ? (
          <>
            <label className="project-search">
              <Search size={15} />
              <input
                type="search"
                data-initial-focus
                data-control-id="input-find-project"
                aria-label="Find a project"
                placeholder="Find a project"
                value={query}
                aria-controls={`${id}-targets`}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelected(null);
                }}
              />
            </label>
            <ul
              className="project-options"
              role="listbox"
              id={`${id}-targets`}
              tabIndex={0}
              aria-label="Active projects"
              aria-activedescendant={destination ? `${id}-${destination.id}` : undefined}
              onKeyDown={(event) => {
                if (
                  !['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key) ||
                  !options.length
                )
                  return;
                event.preventDefault();
                const index = options.findIndex((value) => value.id === selected);
                const next =
                  event.key === 'End'
                    ? options.length - 1
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'ArrowUp'
                        ? Math.max(0, index - 1)
                        : event.key === 'ArrowDown'
                          ? Math.min(options.length - 1, index + 1)
                          : Math.max(0, index);
                setSelected(options[next].id);
              }}
            >
              {!targets.length && (
                <li role="presentation" className="project-no-results">
                  No active project matches this search.
                </li>
              )}
              {targets.map((value) => (
                <li
                  key={value.id}
                  role="option"
                  id={`${id}-${value.id}`}
                  className={value.id === selected ? 'is-active' : ''}
                  aria-selected={value.id === selected}
                  aria-disabled={value.id === chat.projectId}
                  data-control-id={`option-project-${controlSlug(value.name)}`}
                  onClick={(event) => {
                    if (value.id === chat.projectId) return;
                    setSelected(value.id);
                    event.currentTarget.parentElement?.focus();
                  }}
                >
                  <Folder size={15} />
                  <span>{value.name}</span>
                  <small>
                    {value.id === chat.projectId
                      ? 'Current project'
                      : countLabel(
                          controller.conversations.filter((item) => item.projectId === value.id)
                            .length,
                          'chat',
                        )}
                  </small>
                </li>
              ))}
            </ul>
            {destination &&
              (ownSystemPrompt(chat) !== null ? (
                <Feedback severity="warning" title="This chat has its own system prompt">
                  In {destination.name} it uses the project instructions instead. Your prompt is
                  kept with the chat and returns if you remove it from the project.
                </Feedback>
              ) : (
                <p className="field-help">
                  The chat will use the instructions and included files of {destination.name} from
                  its next message.
                </p>
              ))}
            {feedback}
            <div className="panel-actions">
              {cancel}
              <button
                type="button"
                className="primary-button"
                data-control-id="button-confirm-move"
                disabled={busy || !destination}
                onClick={() =>
                  destination && void perform(() => controller.moveChat(chat, destination.id))
                }
              >
                {destination ? `Move to ${destination.name}` : 'Choose a project'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>There are no active projects yet. Create one and this chat moves into it.</p>
            <div className="panel-actions">
              {cancel}
              <button
                className="primary-button"
                data-control-id="button-new-project-for-chat"
                onClick={() => setProjectDialog({ kind: 'create', conversationId: chat.id })}
              >
                New project
              </button>
            </div>
          </>
        )}
      </ConfirmationFrame>
    );
  }
  if (!project)
    return (
      <ConfirmationFrame project title="Project unavailable">
        <p>Reload projects to continue.</p>
        {cancel}
      </ConfirmationFrame>
    );
  if (dialog.kind === 'instructions') {
    return (
      <div className="panel-backdrop">
        <section
          className="panel project-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          data-project-dialog
          aria-busy={busy}
        >
          <div className="panel-heading">
            <h2 id={`${id}-title`}>Project instructions</h2>
            <button
              data-control-id="button-close-panel"
              aria-label="Close project instructions"
              disabled={busy}
              onClick={close}
            >
              <X size={18} />
            </button>
          </div>
          <p className="panel-intro">
            Replaces the Settings system prompt for every chat in this project.
          </p>
          <label className="setting-field">
            <span>Instructions</span>
            <textarea
              className="settings-textarea"
              rows={12}
              data-initial-focus
              data-control-id="textarea-edit-project-instructions"
              value={instructions}
              readOnly={project.archived}
              aria-describedby={`${id}-count`}
              onChange={(event) => setInstructions(event.target.value)}
            />
            <small id={`${id}-count`}>
              ≈ {estimateProjectTokens(instructions).toLocaleString('en-US')} tokens (estimate)
            </small>
          </label>
          <p className="field-help">
            Leave empty to use the system prompt from Settings in this project.
          </p>
          {controller.generating && controller.chat.projectId === project.id && (
            <p className="field-help">Changes apply from the next message.</p>
          )}
          {feedback}
          <div className="panel-actions">
            {cancel}
            <button
              className="primary-button"
              data-control-id="button-save-instructions"
              disabled={busy || project.archived}
              onClick={() =>
                void perform(async () => {
                  await projects.update(project.id, { instructions });
                  projects.setNotice({
                    message: `Saved the instructions for ${countLabel(members.length, 'chat')} in ${project.name}.`,
                  });
                })
              }
            >
              Save instructions
            </button>
          </div>
        </section>
      </div>
    );
  }
  const lifecycleBusy = controller.generating && controller.chat.projectId === project.id;
  const unavailable = project.archived || lifecycleBusy;
  if (dialog.kind === 'archive') {
    return (
      <ConfirmationFrame
        busy={busy}
        project
        title={`Archive “${project.name}”?`}
        description="Its chats stay readable, but you can’t add chats, instructions or files. Restore it anytime from Projects › Archived."
      >
        {feedback}
        {lifecycleBusy && (
          <p className="field-help">Available when the current response finishes or is stopped</p>
        )}
        <div className="panel-actions">
          {cancel}
          <button
            className="primary-button"
            data-control-id="button-archive-project"
            disabled={busy || unavailable}
            onClick={() =>
              void perform(async () => {
                const result = await projects.update(project.id, { archived: true });
                projects.setNotice({
                  message: `Archived “${project.name}”. Find it under Projects › Archived.`,
                  undoToken: result.undoToken,
                });
              })
            }
          >
            Archive project
          </button>
        </div>
      </ConfirmationFrame>
    );
  }
  return (
    <ConfirmationFrame
      busy={busy}
      project
      title={`Delete “${project.name}”?`}
      description="The project, its instructions and its files are permanently deleted. Originals on your disk aren’t affected."
    >
      {!!members.length && (
        <label className="project-check">
          <input
            type="checkbox"
            data-control-id="checkbox-also-delete-chats"
            checked={alsoChats}
            onChange={(event) => setAlsoChats(event.target.checked)}
            disabled={busy}
          />
          <span>
            Also delete its {countLabel(members.length, 'chat')}
            <small>
              Otherwise they move to Conversations and use their own system prompt again.
            </small>
          </span>
        </label>
      )}
      {feedback}
      {unavailable && (
        <p className="field-help">
          {project.archived
            ? 'Restore the project to delete it.'
            : 'Available when the current response finishes or is stopped'}
        </p>
      )}
      <div className="panel-actions">
        {cancel}
        <button
          className="danger-button"
          data-control-id="button-delete-project"
          disabled={busy || unavailable}
          onClick={() =>
            void perform(async () => {
              if (controller.chatRef.current.projectId === project.id)
                await controller.save(controller.chatRef.current);
              const result = await projects.deleteProject(project.id, alsoChats);
              for (const value of result.conversations) controller.acceptStoredConversation(value);
              controller.setConversations((values) =>
                values.filter((value) => !result.deletedConversationIds.includes(value.id)),
              );
              if (result.deletedConversationIds.includes(controller.chat.id)) {
                controller.updateChat(newConversation());
                controller.setInput('');
                controller.setEditor(null);
              }
              projects.setNotice({
                message: `Deleted “${project.name}”.${members.length ? (alsoChats ? ` Its ${countLabel(members.length, 'chat')} ${members.length === 1 ? 'was' : 'were'} deleted too.` : ` Its ${countLabel(members.length, 'chat')} moved to Conversations.`) : ''}`,
              });
              controller.openProjects();
            })
          }
        >
          {alsoChats && members.length
            ? `Delete project and ${countLabel(members.length, 'chat')}`
            : 'Delete project'}
        </button>
      </div>
    </ConfirmationFrame>
  );
}
