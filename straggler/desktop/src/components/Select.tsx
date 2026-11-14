import { useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string | number;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'value' | 'onChange' | 'children' | 'onClick' | 'onKeyDown'
> {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
}

interface Position {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  upward: boolean;
}

export default function Select({ value, options, onChange, ...props }: SelectProps) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const listId = `${id}-list`;
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [active, setActive] = useState(-1);
  const typed = useRef({ text: '', time: 0 });
  const selected = options.findIndex((option) => String(option.value) === value);
  const enabled = options
    .map((option, index) => (option.disabled ? -1 : index))
    .filter((i) => i >= 0);
  const highlighted = enabled.includes(active) ? active : (enabled[0] ?? -1);
  const open = position !== null;

  function nearest(index: number, direction: number) {
    for (let i = index; i >= 0 && i < options.length; i += direction) {
      if (!options[i].disabled) return i;
    }
    return direction > 0 ? (enabled[enabled.length - 1] ?? -1) : (enabled[0] ?? -1);
  }

  function show(index = selected) {
    const trigger = button.current;
    if (!trigger || trigger.matches(':disabled') || !enabled.length) return;
    // WebKit on macOS does not focus buttons when their label is clicked.
    // Keyboard navigation and aria-activedescendant belong to this trigger.
    trigger.focus({ preventScroll: true });
    const bounds = trigger.getBoundingClientRect();
    const needed = Math.min(
      288,
      12 + options.reduce((height, option) => height + (option.description ? 54 : 38), 0),
    );
    const below = window.innerHeight - bounds.bottom - 14;
    const above = bounds.top - 14;
    const upward = below < needed && above > below;
    const maxHeight = Math.max(0, Math.min(needed, upward ? above : below));
    const width = Math.min(Math.max(bounds.width, 220), window.innerWidth - 16);
    setActive(enabled.includes(index) ? index : enabled[0]);
    setPosition({
      left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
      top: upward ? bounds.top - 6 : bounds.bottom + 6,
      width,
      maxHeight,
      upward,
    });
  }

  function hide() {
    typed.current = { text: '', time: 0 };
    setPosition(null);
  }

  function choose(index: number) {
    const option = options[index];
    if (option && !option.disabled && String(option.value) !== value)
      onChange(String(option.value));
    hide();
  }

  function typeahead(character: string) {
    const now = Date.now();
    const text =
      (now - typed.current.time < 600 ? typed.current.text : '') + character.toLocaleLowerCase();
    typed.current = { text, time: now };
    const repeated = [...text].every((letter) => letter === text[0]);
    const query = repeated ? text[0] : text;
    const start = open ? highlighted : selected;
    for (let offset = repeated ? 1 : 0; offset < options.length + (repeated ? 1 : 0); offset++) {
      const index = (Math.max(start, 0) + offset) % options.length;
      if (!options[index].disabled && options[index].label.toLocaleLowerCase().startsWith(query)) {
        if (open) setActive(index);
        else show(index);
        return;
      }
    }
  }

  function keydown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      hide();
      return;
    }
    if (event.key === 'Tab') {
      if (open) choose(highlighted);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(highlighted);
      else show();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) {
      event.preventDefault();
      if (event.altKey && event.key === 'ArrowUp' && open) {
        choose(highlighted);
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        const index = event.key === 'Home' ? enabled[0] : enabled[enabled.length - 1];
        if (open) setActive(index ?? -1);
        else show(index);
      } else if (!open) {
        show(event.key === 'ArrowUp' ? nearest(selected - 1, -1) : selected);
      } else if (!event.altKey) {
        const direction = event.key === 'ArrowUp' || event.key === 'PageUp' ? -1 : 1;
        const distance = event.key.startsWith('Page') ? 10 : 1;
        const target = Math.max(
          0,
          Math.min(options.length - 1, highlighted + direction * distance),
        );
        setActive(nearest(target, direction));
      }
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      typeahead(event.key);
    }
  }

  useEffect(() => {
    if (!open) return;
    if (button.current?.matches(':disabled') || !enabled.length) {
      hide();
      return;
    }
    function outside(event: PointerEvent) {
      if (
        !button.current?.contains(event.target as Node) &&
        !list.current?.contains(event.target as Node)
      ) {
        hide();
      }
    }
    function close() {
      hide();
    }
    function wheel(event: WheelEvent) {
      if (!list.current?.contains(event.target as Node)) close();
    }
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', wheel, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', wheel);
    };
  }, [open, props.disabled, enabled.length]);

  useEffect(() => {
    const popup = list.current;
    const option = popup?.children[highlighted] as HTMLElement | undefined;
    if (!open || !popup || !option) return;
    // Scroll only the list: scrollIntoView can move its surrounding native webview.
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < popup.scrollTop) popup.scrollTop = top - 5;
    else if (bottom > popup.scrollTop + popup.clientHeight)
      popup.scrollTop = bottom - popup.clientHeight + 5;
  }, [open, highlighted]);

  return (
    <span className="ss">
      <button
        {...props}
        ref={button}
        id={id}
        type="button"
        role="combobox"
        className={`ss-button ${props.className ?? ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && highlighted >= 0 ? `${id}-option-${highlighted}` : undefined}
        onClick={() => (open ? hide() : show())}
        onKeyDown={keydown}
        onBlur={(event) => {
          hide();
          props.onBlur?.(event);
        }}
      >
        <span className="ss-value">{options[selected]?.label ?? ''}</span>
        <ChevronDown className="ss-chev" aria-hidden="true" />
      </button>
      {position &&
        createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-label={props['aria-label']}
            aria-labelledby={props['aria-label'] ? undefined : id}
            className={`ss-list${position.upward ? ' is-up' : ''}`}
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
            onPointerDown={(event) => event.preventDefault()}
          >
            {options.map((option, index) => (
              <li
                key={String(option.value)}
                id={`${id}-option-${index}`}
                role="option"
                data-value={String(option.value)}
                aria-selected={String(option.value) === value}
                aria-label={option.description ? option.label : undefined}
                aria-disabled={option.disabled || undefined}
                aria-describedby={option.description ? `${id}-description-${index}` : undefined}
                className={`ss-option${index === highlighted ? ' is-active' : ''}`}
                onPointerMove={() => {
                  if (!option.disabled) setActive(index);
                }}
                onClick={() => {
                  if (!option.disabled) choose(index);
                }}
              >
                <span>{option.label}</span>
                {option.description && (
                  <small id={`${id}-description-${index}`}>{option.description}</small>
                )}
                <Check className="ss-check" aria-hidden="true" />
              </li>
            ))}
          </ul>,
          button.current?.closest('[role="dialog"], [role="alertdialog"]') ?? document.body,
        )}
    </span>
  );
}
