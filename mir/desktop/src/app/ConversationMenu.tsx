import { useEffect, useId, useRef, useState } from 'react';
import { Download, MoreHorizontal, Trash2 } from 'lucide-react';
import type { Conversation } from '../domain/types';

export default function ConversationMenu({
  conversation,
  disabled,
  onDelete,
  onExport,
}: {
  conversation: Conversation;
  disabled: boolean;
  onDelete: () => void;
  onExport?: (includesReasoning: boolean) => void;
}) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const lastItem = useRef(false);
  const id = useId();
  const hasReasoning = conversation.messages.some(
    (message) => message.role === 'assistant' && !!message.reasoning,
  );

  function close(restoreFocus = false) {
    setPosition(null);
    if (restoreFocus) button.current?.focus();
  }
  function open(last = false) {
    const bounds = button.current?.getBoundingClientRect();
    if (!bounds) return;
    lastItem.current = last;
    setPosition({
      top: Math.min(bounds.bottom + 4, innerHeight - 190),
      left: Math.max(8, Math.min(bounds.right - 225, innerWidth - 233)),
    });
  }
  useEffect(() => {
    if (!position) return;
    const items = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (items?.length) items[lastItem.current ? items.length - 1 : 0].focus();
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) close();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    }
    const dismiss = () => close();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [position]);
  return (
    <>
      <button
        ref={button}
        className="chat-menu-button"
        type="button"
        aria-label={`Options for ${conversation.title}`}
        title="Conversation options"
        aria-haspopup="menu"
        aria-expanded={!!position}
        aria-controls={position ? id : undefined}
        disabled={disabled}
        onClick={() => (position ? close() : open())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            open(event.key === 'ArrowUp');
          }
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {position && (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={`Options for ${conversation.title}`}
          className="chat-menu"
          style={position}
          onKeyDown={(event) => {
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
            );
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            let next: number;
            if (event.key === 'ArrowDown') next = (current + 1) % items.length;
            else if (event.key === 'ArrowUp') next = (current + items.length - 1) % items.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = items.length - 1;
            else if (event.key === 'Tab') {
              close(true);
              return;
            } else return;
            event.preventDefault();
            items[next]?.focus();
          }}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-disabled={!onExport}
            onClick={() => {
              if (onExport) {
                close(true);
                onExport(false);
              }
            }}
          >
            <Download size={15} />
            Export chat…
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-disabled={!onExport || !hasReasoning}
            title={!hasReasoning ? 'This conversation contains no reasoning.' : undefined}
            aria-describedby={!hasReasoning ? `${id}-reasoning` : undefined}
            onClick={() => {
              if (onExport && hasReasoning) {
                close(true);
                onExport(true);
              }
            }}
          >
            <Download size={15} />
            Export with reasoning…
          </button>
          {!hasReasoning && (
            <p className="menu-note" id={`${id}-reasoning`}>
              This conversation contains no reasoning.
            </p>
          )}
          <div className="chat-menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="is-danger"
            aria-label={`Delete ${conversation.title}`}
            onClick={() => {
              close(true);
              onDelete();
            }}
          >
            <Trash2 size={15} />
            Delete
          </button>
        </div>
      )}
    </>
  );
}
