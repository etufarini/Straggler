import { useCallback, useId, useRef, useState } from 'react';
import {
  Bold,
  Italic,
  Strikethrough,
  Link,
  ListOrdered,
  List,
  TextQuote,
  Code,
  SquareCode,
} from 'lucide-react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import Popover from '../../../components/Popover';
import { applyFormatting, focusComposer, formattingDisabled, isMac } from './commands';
import { normalizeComposerUrl } from './markdown';

const tools = [
  { action: 'bold', label: 'Bold', Icon: Bold, keys: ['B'] },
  { action: 'italic', label: 'Italic', Icon: Italic, keys: ['I'] },
  { action: 'strike', label: 'Strikethrough', Icon: Strikethrough, keys: ['Shift', 'X'] },
  { action: 'link', label: 'Link', Icon: Link, keys: ['Shift', 'U'], separator: true },
  {
    action: 'orderedList',
    label: 'Numbered list',
    Icon: ListOrdered,
    keys: ['Shift', '7'],
    separator: true,
  },
  { action: 'bulletList', label: 'Bulleted list', Icon: List, keys: ['Shift', '8'] },
  { action: 'blockquote', label: 'Quote', Icon: TextQuote, keys: ['Shift', '9'], separator: true },
  { action: 'code', label: 'Code', Icon: Code, keys: ['Shift', 'C'], separator: true },
  { action: 'codeBlock', label: 'Code block', Icon: SquareCode, keys: ['Alt', 'Shift', 'C'] },
] as const;

export default function FormattingToolbar({
  editor,
  fieldId,
  linkButtonId,
  visible,
}: {
  editor: Editor;
  fieldId: string;
  linkButtonId: string;
  visible: boolean;
}) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [link, setLink] = useState({ text: '', url: '', existing: false, from: 0, to: 0 });
  const [error, setError] = useState('');
  const errorId = useId();
  const returnFocus = useCallback(() => {
    focusComposer(editor);
  }, [editor]);
  const state = useEditorState({
    editor,
    selector: ({ editor }) =>
      tools.map(({ action }) => ({
        active: editor.isActive(action),
        disabled: formattingDisabled(editor, action),
      })),
  });
  const enabledIndex = state[focusIndex]?.disabled
    ? state.findIndex((tool) => !tool.disabled)
    : focusIndex;
  function openLink() {
    document.getElementById(linkButtonId)?.click();
  }
  function prepareLink() {
    if (formattingDisabled(editor, 'link')) return false;
    const existing = editor.isActive('link');
    if (existing) editor.commands.extendMarkRange('link');
    const { from, to } = editor.state.selection;
    setLink({
      existing,
      from,
      to,
      text: editor.state.doc.textBetween(from, to),
      url: String(editor.getAttributes('link').href ?? ''),
    });
    setError('');
    return true;
  }
  function saveLink(close: () => void) {
    const href = normalizeComposerUrl(link.url);
    if (!href) {
      setError('Enter a link like https://example.com');
      return;
    }
    const text = link.text || href;
    const chain = editor.chain().setTextSelection({ from: link.from, to: link.to });
    if (text === editor.state.doc.textBetween(link.from, link.to)) chain.setLink({ href });
    else chain.insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] });
    chain
      .command(({ tr }) => {
        tr.setSelection(TextSelection.near(tr.doc.resolve(tr.selection.to)));
        return true;
      })
      .run();
    close();
  }
  return (
    <div
      ref={toolbar}
      role={visible ? 'toolbar' : undefined}
      aria-label={visible ? 'Formatting' : undefined}
      aria-controls={fieldId}
      className={`formatting-toolbar${visible ? '' : ' is-hidden'}`}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest('.composer-popover')) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          focusComposer(editor);
          return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
          return;
        event.preventDefault();
        const buttons = [
          ...(toolbar.current?.querySelectorAll<HTMLButtonElement>(
            '.format-button:not(:disabled)',
          ) ?? []),
        ];
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }}
    >
      {tools.map(({ action, label, Icon, keys, ...tool }, index) => {
        const ariaKeys = [isMac() ? 'Meta' : 'Control', ...keys].join('+');
        const shortcut = isMac()
          ? ['⌘', ...keys.map((key) => (key === 'Shift' ? '⇧' : key === 'Alt' ? '⌥' : key))].join(
              '',
            )
          : ['Ctrl', ...keys].join('+');
        const title = `${label} (${shortcut})`;
        const buttonProps = {
          className: 'format-button',
          tabIndex: visible && enabledIndex === index ? 0 : -1,
          'aria-keyshortcuts': ariaKeys,
          onFocus: () => setFocusIndex(index),
          onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault(),
        };
        return (
          <div className="format-tool" key={action}>
            {'separator' in tool && <span className="format-separator" aria-hidden="true" />}
            {action === 'link' ? (
              <Popover
                label="Link"
                heading={link.existing ? 'Edit link' : 'Add link'}
                title={title}
                pressed={state[index].active}
                disabled={state[index].disabled}
                trigger={<Icon size={16} />}
                triggerProps={{ ...buttonProps, id: linkButtonId }}
                onTrigger={prepareLink}
                containFocus
                returnFocus={returnFocus}
                popoverClassName="composer-link-popover"
              >
                {(close) => (
                  <div
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        event.stopPropagation();
                        saveLink(close);
                      }
                    }}
                  >
                    <label>
                      Text
                      <input
                        data-initial-focus
                        value={link.text}
                        onChange={(event) => setLink({ ...link, text: event.target.value })}
                      />
                    </label>
                    <label>
                      Link
                      <input
                        value={link.url}
                        placeholder="https://example.com"
                        aria-invalid={!!error}
                        aria-describedby={error ? errorId : undefined}
                        onChange={(event) => {
                          setLink({ ...link, url: event.target.value });
                          setError('');
                        }}
                      />
                    </label>
                    {error && (
                      <p id={errorId} className="field-error" role="alert">
                        {error}
                      </p>
                    )}
                    <div className="popover-actions">
                      {link.existing && (
                        <button
                          type="button"
                          onClick={() => {
                            editor
                              .chain()
                              .setTextSelection({ from: link.from, to: link.to })
                              .unsetLink()
                              .run();
                            close();
                          }}
                        >
                          Remove link
                        </button>
                      )}
                      <button type="button" onClick={close}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => saveLink(close)}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </Popover>
            ) : (
              <button
                {...buttonProps}
                type="button"
                aria-label={label}
                title={title}
                aria-pressed={state[index].active}
                disabled={state[index].disabled}
                onClick={() => applyFormatting(editor, action, openLink)}
              >
                <Icon size={16} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
