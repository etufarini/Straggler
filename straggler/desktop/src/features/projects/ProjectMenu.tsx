import { Archive, ArchiveRestore, Pencil, Star, Trash2 } from 'lucide-react';
import ActionMenu, { controlSlug } from '../../components/ActionMenu';
import type { ActionMenuItem } from '../../components/ActionMenu';
import type { Project } from '../../domain/projects';

export default function ProjectMenu({
  project,
  onEdit,
  onArchive,
  onDelete,
  onRestore,
  onStar,
  busyReason,
  controlId,
}: {
  project: Project;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onStar: () => void;
  busyReason?: string;
  controlId?: string;
}) {
  const items: ActionMenuItem[] = project.archived
    ? [
        {
          label: 'Restore',
          controlId: 'button-restore-project-menu',
          icon: <ArchiveRestore size={15} />,
          disabled: !!busyReason,
          disabledReason: busyReason,
          onSelect: onRestore,
        },
        {
          label: 'Delete',
          controlId: 'button-delete-project-menu',
          icon: <Trash2 size={15} />,
          destructive: true,
          separatorBefore: true,
          disabled: true,
          disabledReason: 'Restore the project to delete it.',
          onSelect: onDelete,
        },
      ]
    : [
        {
          label: project.starred ? 'Remove star' : 'Star',
          controlId: 'button-star-project-menu',
          icon: <Star size={15} />,
          onSelect: onStar,
        },
        {
          label: 'Edit details…',
          controlId: 'button-edit-project-details',
          icon: <Pencil size={15} />,
          onSelect: onEdit,
        },
        {
          label: 'Archive',
          controlId: 'button-archive-project-menu',
          icon: <Archive size={15} />,
          disabled: !!busyReason,
          disabledReason: busyReason,
          onSelect: onArchive,
        },
        {
          label: 'Delete',
          controlId: 'button-delete-project-menu',
          icon: <Trash2 size={15} />,
          destructive: true,
          separatorBefore: true,
          disabled: !!busyReason,
          disabledReason: busyReason,
          onSelect: onDelete,
        },
      ];
  return (
    <ActionMenu
      label={`Options for project ${project.name}`}
      title="Project options"
      controlId={controlId ?? `button-options-for-project-${controlSlug(project.name)}`}
      className="project-icon-button"
      items={items}
    />
  );
}
