import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

export function controlSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'item'
  );
}

export interface ActionMenuItem {
  label: string;
  controlId: string;
  icon: ReactNode;
  onSelect: () => void;
  ariaLabel?: string;
  disabled?: boolean;
  disabledReason?: string;
  destructive?: boolean;
  separatorBefore?: boolean;
}

export default function ActionMenu({
  label,
  title,
  controlId,
  className = 'chat-menu-button',
  disabled = false,
  items,
}: {
  label: string;
  title: string;
  controlId: string;
  className?: string;
  disabled?: boolean;
  items: ActionMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const lastItem = useRef(false);
  const id = useId();

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) button.current?.focus({ preventScroll: true });
  }
  function show(last = false) {
    lastItem.current = last;
    setOpen(true);
  }
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = button.current?.getBoundingClientRect();
    const bounds = menu.current?.getBoundingClientRect();
    if (!anchor || !bounds) return;
    setPosition({
      top: Math.max(8, Math.min(anchor.bottom + 4, innerHeight - bounds.height - 8)),
      left: Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8)),
    });
    const controls = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (controls?.length)
      controls[lastItem.current ? controls.length - 1 : 0].focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
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
  }, [open]);
  return (
    <>
      <button
        ref={button}
        className={className}
        type="button"
        aria-label={label}
        title={title}
        data-control-id={controlId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show(event.key === 'ArrowUp');
          }
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label={label}
            className="chat-menu"
            style={{ ...position, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}
            onKeyDown={(event) => {
              const controls = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
              );
              const current = controls.indexOf(document.activeElement as HTMLButtonElement);
              let next: number;
              if (event.key === 'ArrowDown') next = (current + 1) % controls.length;
              else if (event.key === 'ArrowUp')
                next = (current + controls.length - 1) % controls.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = controls.length - 1;
              else if (event.key === 'Tab') {
                close(true);
                return;
              } else return;
              event.preventDefault();
              controls[next]?.focus();
            }}
          >
            {items.map((item, index) => {
              const reasonIndex = item.disabledReason
                ? items.findIndex((value) => value.disabledReason === item.disabledReason)
                : -1;
              const reasonId = reasonIndex >= 0 ? `${id}-reason-${reasonIndex}` : undefined;
              return (
                <Fragment key={item.controlId}>
                  {item.separatorBefore && <div className="chat-menu-separator" role="separator" />}
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={item.destructive ? 'is-danger' : undefined}
                    aria-label={item.ariaLabel}
                    aria-disabled={item.disabled || undefined}
                    aria-describedby={reasonId}
                    data-control-id={item.controlId}
                    onClick={() => {
                      if (item.disabled) return;
                      close(true);
                      item.onSelect();
                    }}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                  {item.disabledReason && reasonIndex === index && (
                    <p className="menu-note" id={reasonId}>
                      {item.disabledReason}
                    </p>
                  )}
                </Fragment>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
