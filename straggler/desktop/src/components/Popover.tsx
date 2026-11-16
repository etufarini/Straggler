import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { X } from 'lucide-react';
import { containTabFocus } from './focus';

export default function Popover({
  label,
  valueLabel,
  trigger,
  children,
  className = '',
  disabled = false,
  controlId,
  closeControlId,
  containFocus = false,
  popoverClassName = '',
  heading,
  pressed,
  title,
  onTrigger,
  triggerProps,
  returnFocus,
}: {
  label: string;
  valueLabel?: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
  disabled?: boolean;
  controlId?: string;
  closeControlId?: string;
  containFocus?: boolean;
  popoverClassName?: string;
  heading?: string;
  pressed?: boolean;
  title?: string;
  onTrigger?: () => boolean;
  triggerProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  returnFocus?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLElement>(null);
  const close = () => setOpen(false);
  useLayoutEffect(() => {
    const panel = popover.current;
    const opener = button.current;
    const composer = opener?.closest('.composer');
    if (!open || !panel || !composer || !opener) return;
    function position() {
      if (!panel || !composer || !opener) return;
      const bounds = composer.getBoundingClientRect();
      const trigger = opener.getBoundingClientRect();
      const left = Math.max(
        bounds.left + 11,
        Math.min(trigger.left, bounds.right - 11 - panel.getBoundingClientRect().width),
      );
      panel.style.left = `${left - bounds.left - composer.clientLeft}px`;
      panel.style.maxHeight = `${Math.max(0, Math.min(440, window.innerHeight * 0.65, bounds.top - 18))}px`;
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(composer);
    observer.observe(panel);
    observer.observe(opener);
    window.addEventListener('resize', position);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const opener = button.current;
    (
      root.current?.querySelector<HTMLElement>('[data-initial-focus]') ??
      root.current?.querySelector<HTMLElement>(
        '.composer-popover button, .composer-popover input, .composer-popover textarea',
      )
    )?.focus();
    function keydown(event: KeyboardEvent) {
      if (containFocus) containTabFocus(event, root.current?.querySelector('.composer-popover'));
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    }
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('pointerdown', outside);
      if (returnFocus) returnFocus();
      else if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, containFocus, returnFocus]);
  return (
    <div ref={root} className={`composer-menu ${className}`}>
      <button
        {...triggerProps}
        ref={button}
        data-control-id={controlId}
        type="button"
        className={triggerProps?.className ?? 'composer-chip'}
        aria-pressed={pressed}
        title={title ?? (valueLabel ? `${label}: ${valueLabel}` : label)}
        aria-label={label}
        aria-describedby={valueLabel ? `${id}-value` : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => {
          if (onTrigger && !onTrigger()) {
            setOpen(false);
            return;
          }
          setOpen(!open);
        }}
      >
        {trigger}
      </button>
      {valueLabel && (
        <span id={`${id}-value`} className="visually-hidden">
          {valueLabel}
        </span>
      )}
      {open && (
        <section
          ref={popover}
          className={`composer-popover ${popoverClassName}`}
          id={id}
          role="dialog"
          aria-label={label}
        >
          <div className="popover-header">
            <strong>{heading ?? label}</strong>
            <button
              type="button"
              data-control-id={closeControlId}
              aria-label={
                closeControlId === 'button-close-project-instructions'
                  ? 'Close project instructions'
                  : `Close ${label.toLowerCase()}`
              }
              onClick={close}
            >
              <X size={16} />
            </button>
          </div>
          {children(close)}
        </section>
      )}
    </div>
  );
}
