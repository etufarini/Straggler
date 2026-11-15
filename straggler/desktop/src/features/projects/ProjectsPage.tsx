import usePagePrimaryAction from '../../app/usePagePrimaryAction';
import { Folder, Plus, Search, Star } from 'lucide-react';
import { useState } from 'react';
import type { WorkspaceController } from '../../app/useWorkspace';
import ProjectMenu from './ProjectMenu';
import type { Project } from '../../domain/projects';
import { projectUpdatedAt } from '../../domain/projects';
import { controlSlug } from '../../components/ActionMenu';
import Select from '../../components/Select';

export function projectActions(controller: WorkspaceController, project: Project) {
  const { projects, setProjectDialog } = controller;
  return {
    project,
    busyReason:
      controller.generating && controller.chat.projectId === project.id
        ? 'Available when the current response finishes or is stopped'
        : undefined,
    onEdit: () => setProjectDialog({ kind: 'edit', id: project.id }),
    onArchive: () => setProjectDialog({ kind: 'archive', id: project.id }),
    onDelete: () => setProjectDialog({ kind: 'delete', id: project.id }),
    onStar: () => {
      void projects
        .update(project.id, { starred: !project.starred })
        .then((result) =>
          projects.setNotice({
            message: result.project.starred
              ? `Starred “${project.name}”. It is pinned in the sidebar.`
              : `Removed the star from “${project.name}”.`,
          }),
        )
        .catch(() => {});
    },
    onRestore: () => {
      void projects
        .update(project.id, { archived: false })
        .then((result) =>
          projects.setNotice({
            message: `Restored “${project.name}”.`,
            undoToken: result.undoToken,
          }),
        )
        .catch(() => {});
    },
  };
}

export default function ProjectsPage({
  controller,
  onPrimaryActionChange,
}: {
  controller: WorkspaceController;
  onPrimaryActionChange: (active: boolean) => void;
}) {
  const { projects, openProject, setProjectDialog } = controller;
  usePagePrimaryAction(projects.ready, onPrimaryActionChange);
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('updated');
  const active = projects.projects.filter((project) => !project.archived).length;
  const values = projects.projects
    .filter(
      (project) =>
        project.archived === (tab === 'archived') &&
        `${project.name} ${project.description}`.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .sort(
      sort === 'name'
        ? (a, b) => a.name.localeCompare(b.name)
        : (a, b) =>
            projectUpdatedAt(b, controller.conversations) -
            projectUpdatedAt(a, controller.conversations),
    );
  function changeTab(value: 'active' | 'archived') {
    setTab(value);
    document.querySelector<HTMLButtonElement>(`[data-control-id="tab-${value}-projects"]`)?.focus();
  }
  return (
    <section className="settings-page project-page" aria-labelledby="projects-title">
      <div className="project-page-head">
        <div>
          <h1 id="projects-title" tabIndex={-1}>
            Projects
          </h1>
          <p>Group chats that share instructions and files. Everything stays on this device.</p>
        </div>
        {!!projects.projects.length && (
          <button
            className="primary-button"
            data-control-id="button-new-project-page"
            disabled={!projects.ready}
            onClick={(event) => setProjectDialog({ kind: 'create' }, event.currentTarget)}
          >
            <Plus size={15} />
            New project
          </button>
        )}
      </div>
      {!projects.ready ? (
        <p role="status">Loading projects…</p>
      ) : !projects.projects.length ? (
        <div className="project-empty">
          <span className="project-card-icon">
            <Folder size={22} />
          </span>
          <h2>No projects yet</h2>
          <p>
            A project keeps related chats together. Its instructions become the system prompt of
            every chat in it, and its files are read into each chat’s context.
          </p>
          <button
            className="primary-button"
            data-control-id="button-create-first-project"
            onClick={(event) => setProjectDialog({ kind: 'create' }, event.currentTarget)}
          >
            <Plus size={15} />
            Create a project
          </button>
        </div>
      ) : (
        <>
          <div className="project-toolbar">
            <div className="project-tabs" role="tablist" aria-label="Project status">
              {(['active', 'archived'] as const).map((value) => (
                <button
                  key={value}
                  role="tab"
                  id={`projects-tab-${value}`}
                  aria-selected={tab === value}
                  aria-controls="projects-tabpanel"
                  tabIndex={tab === value ? 0 : -1}
                  data-control-id={`tab-${value}-projects`}
                  onClick={() => changeTab(value)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                      event.preventDefault();
                      changeTab(tab === 'active' ? 'archived' : 'active');
                    }
                  }}
                >
                  {value === 'active'
                    ? `Active (${active})`
                    : `Archived (${projects.projects.length - active})`}
                </button>
              ))}
            </div>
            <label className="project-search">
              <Search size={15} />
              <input
                type="search"
                aria-label="Search projects"
                placeholder="Search projects"
                value={query}
                data-control-id="input-search-projects"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="project-sort">
              <span>Sort</span>
              <Select
                aria-label="Sort"
                value={sort}
                data-control-id="select-sort-projects"
                onChange={setSort}
                options={[
                  { value: 'updated', label: 'Recently updated' },
                  { value: 'name', label: 'Name' },
                ]}
              />
            </label>
          </div>
          <div role="tabpanel" id="projects-tabpanel" aria-labelledby={`projects-tab-${tab}`}>
            {!values.length ? (
              <p className="project-no-results">
                {query.trim() ? (
                  <>
                    No {tab === 'archived' ? 'archived ' : ''}projects match “{query.trim()}”.{' '}
                    <button
                      className="text-button"
                      data-control-id="button-clear-search"
                      onClick={() => {
                        setQuery('');
                        document
                          .querySelector<HTMLInputElement>(
                            '[data-control-id="input-search-projects"]',
                          )
                          ?.focus();
                      }}
                    >
                      Clear search
                    </button>
                  </>
                ) : tab === 'archived' ? (
                  'No archived projects. Archiving keeps a project’s chats readable while removing it from the sidebar and this list.'
                ) : (
                  'Every project is archived. Create a project or restore one from Archived.'
                )}
              </p>
            ) : (
              <ul className="project-grid">
                {values.map((project) => {
                  const context = projects.context(project);
                  const actions = projectActions(controller, project);
                  return (
                    <li
                      className={`project-card${project.archived ? ' is-archived' : ''}`}
                      key={project.id}
                    >
                      <div className="project-card-top">
                        <button
                          className="project-card-open"
                          data-control-id={`button-open-project-${controlSlug(project.name)}`}
                          onClick={() => openProject(project.id)}
                          aria-describedby={`project-description-${project.id} project-meta-${project.id}`}
                        >
                          <span className="project-card-icon">
                            <Folder size={16} />
                          </span>
                          <span>{project.name}</span>
                        </button>
                        {!project.archived && (
                          <button
                            className="project-icon-button project-star"
                            data-control-id={`button-star-${controlSlug(project.name)}`}
                            aria-label={`Star ${project.name}`}
                            aria-pressed={project.starred}
                            onClick={actions.onStar}
                          >
                            <Star size={16} />
                          </button>
                        )}
                        <ProjectMenu {...actions} />
                      </div>
                      <p
                        className={`project-card-desc${project.description ? '' : ' is-empty'}`}
                        id={`project-description-${project.id}`}
                      >
                        {project.description || 'No description'}
                      </p>
                      <p className="project-meta" id={`project-meta-${project.id}`}>
                        <span>
                          {
                            controller.conversations.filter((chat) => chat.projectId === project.id)
                              .length
                          }{' '}
                          chats
                        </span>
                        <span>{project.files.length} files</span>
                        <span>
                          Updated{' '}
                          {relativeTime(projectUpdatedAt(project, controller.conversations))}
                        </span>
                        {project.archived ? (
                          <span className="project-badge">Archived</span>
                        ) : context.level === 'over' || context.level === 'high' ? (
                          <span className={`project-badge is-${context.level}`}>
                            {context.level === 'over'
                              ? 'Over context limit'
                              : `Context ${Math.round((context.ratio ?? 0) * 100)}%`}
                          </span>
                        ) : null}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
export function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  if (minutes < 2880) return 'yesterday';
  return `${Math.round(minutes / 1440)} days ago`;
}
