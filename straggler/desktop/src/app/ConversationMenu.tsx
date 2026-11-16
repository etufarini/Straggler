import { Download, FolderInput, FolderOutput, Trash2 } from 'lucide-react';
import ActionMenu, { controlSlug } from '../components/ActionMenu';
import type { ActionMenuItem } from '../components/ActionMenu';
import type { Conversation } from '../domain/types';

export default function ConversationMenu({
  conversation,
  disabled = false,
  readOnly = false,
  actionBusyReason,
  controlId,
  onDelete,
  onExport,
  onMove,
  onRemove,
}: {
  conversation: Conversation;
  disabled?: boolean;
  readOnly?: boolean;
  actionBusyReason?: string;
  controlId?: string;
  onDelete: () => void;
  onExport?: (includesReasoning: boolean) => void;
  onMove?: () => void;
  onRemove?: () => void;
}) {
  const hasReasoning = conversation.messages.some(
    (message) => message.role === 'assistant' && !!message.reasoning,
  );
  const mutationReason = readOnly ? 'Restore the project to change this chat.' : actionBusyReason;
  const items: ActionMenuItem[] = [
    {
      label: 'Export chat…',
      controlId: 'button-export-chat',
      icon: <Download size={15} />,
      disabled: !onExport,
      disabledReason: !onExport ? 'Export is unavailable.' : undefined,
      onSelect: () => onExport?.(false),
    },
    {
      label: 'Export with reasoning…',
      controlId: 'button-export-with-reasoning',
      icon: <Download size={15} />,
      disabled: !onExport || !hasReasoning,
      disabledReason: !hasReasoning
        ? 'This chat contains no reasoning.'
        : !onExport
          ? 'Export is unavailable.'
          : undefined,
      onSelect: () => onExport?.(true),
    },
  ];
  if (onMove) {
    items.push({
      label: conversation.projectId ? 'Move to another project…' : 'Move to project…',
      controlId: 'button-move-to-project',
      icon: <FolderInput size={15} />,
      separatorBefore: true,
      disabled: !!mutationReason,
      disabledReason: mutationReason,
      onSelect: onMove,
    });
  }
  if (conversation.projectId && onRemove) {
    items.push({
      label: 'Remove from project',
      controlId: 'button-remove-from-project',
      icon: <FolderOutput size={15} />,
      disabled: !!mutationReason,
      disabledReason: mutationReason,
      onSelect: onRemove,
    });
  }
  items.push({
    label: 'Delete',
    ariaLabel: `Delete ${conversation.title}`,
    controlId: `button-delete-${controlSlug(conversation.title)}`,
    icon: <Trash2 size={15} />,
    separatorBefore: true,
    destructive: true,
    disabled: !!mutationReason,
    disabledReason: mutationReason,
    onSelect: onDelete,
  });
  return (
    <ActionMenu
      label={`Options for ${conversation.title}`}
      title="Chat options"
      controlId={controlId ?? `button-options-for-${controlSlug(conversation.title)}`}
      disabled={disabled}
      items={items}
    />
  );
}
