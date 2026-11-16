import { useEffect, useId, useRef } from 'react';
import type { Ref } from 'react';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { ALargeSmall } from 'lucide-react';
import { composerExtensions } from './extensions';
import { composerContext, handleComposerKey, pastePlainText, modifierLabel } from './commands';
import type { ComposerContext } from './commands';
import FormattingToolbar from './FormattingToolbar';
import { normalizeComposerUrl, parseMarkdown, serializeMarkdown } from './markdown';

export function FormattingToggle({
  visible,
  onChange,
  disabled = false,
}: {
  visible: boolean;
  onChange: (visible: boolean) => void;
  disabled?: boolean;
}) {
  const label = visible ? 'Hide formatting' : 'Show formatting';
  return (
    <button
      type="button"
      className="composer-chip formatting-toggle"
      aria-pressed={visible}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!visible)}
    >
      <ALargeSmall size={16} />
    </button>
  );
}

export function composerHint(context: ComposerContext): string {
  if (context === 'code') return `Enter for a new line · ${modifierLabel()} + Enter to send`;
  return context === 'list' ? 'Shift + Enter for a new item' : 'Shift + Enter for a new line';
}

type Props = {
  value: string;
  onChange: (markdown: string) => void;
  onSubmit: () => void;
  toolbarVisible: boolean;
  disabled?: boolean;
  editing?: boolean;
  placeholder?: string;
  label?: string;
  id?: string;
  describedBy?: string;
  controlId?: string;
  focusRef?: Ref<{ focus: () => void }>;
  onContextChange?: (context: ComposerContext) => void;
};

export default function RichComposer(props: Props) {
  const generatedId = useId();
  const fieldId = props.id ?? `message-${generatedId}`;
  const linkButtonId = `link-${generatedId}`;
  const latest = useRef(props);
  latest.current = props;
  const emitted = useRef(props.value);
  const editor: Editor | null = useEditor({
    extensions: composerExtensions(() => latest.current.placeholder ?? ''),
    content: parseMarkdown(props.value),
    editable: !props.disabled,
    enablePasteRules: false,
    editorProps: {
      attributes: {
        id: fieldId,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': props.label ?? 'Message',
        'aria-placeholder': props.placeholder ?? '',
        ...(props.describedBy ? { 'aria-describedby': props.describedBy } : {}),
        'data-control-id': props.controlId ?? '',
        class: 'rich-composer-field markdown',
      },
      handleKeyDown: (_view, event) => {
        if (!editor) return false;
        return handleComposerKey(editor, event, {
          submit: () => latest.current.onSubmit(),
          editing: !!latest.current.editing,
          openLink: () => document.getElementById(linkButtonId)?.click(),
        });
      },
      handlePaste: (_view, event) => {
        if (!editor) return false;
        const url = event.clipboardData?.getData('text/plain');
        const href = url && normalizeComposerUrl(url);
        if (
          href &&
          !editor.state.selection.empty &&
          !editor.isActive('codeBlock') &&
          !editor.isActive('code')
        ) {
          event.preventDefault();
          editor.commands.setLink({ href });
          return true;
        }
        return pastePlainText(editor, event);
      },
      handleClick: (_view, _pos, event) => {
        if ((event.target as HTMLElement).closest('a')) event.preventDefault();
        return false;
      },
      // Native attachment drops are handled by the existing workspace listener.
      handleDrop: (_view, event) => {
        event.preventDefault();
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const markdown = serializeMarkdown(editor.getJSON());
      emitted.current = markdown;
      latest.current.onChange(markdown);
    },
    onTransaction: ({ editor }) => latest.current.onContextChange?.(composerContext(editor)),
  });
  useEffect(() => {
    if (!editor || props.value === emitted.current) return;
    emitted.current = props.value;
    editor.commands.setContent(parseMarkdown(props.value), { emitUpdate: false });
  }, [editor, props.value]);
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!props.disabled, false);
    editor.view.dom.setAttribute('aria-disabled', String(!!props.disabled));
    editor.view.dom.setAttribute('aria-placeholder', props.placeholder ?? '');
    editor.view.dom.tabIndex = props.disabled ? -1 : 0;
  }, [editor, props.disabled, props.placeholder]);
  useEffect(() => {
    if (!editor || !props.focusRef) return;
    const handle = {
      focus: () => {
        editor.commands.focus();
      },
    };
    if (typeof props.focusRef === 'function') return props.focusRef(handle);
    props.focusRef.current = handle;
    return () => {
      if (typeof props.focusRef !== 'function' && props.focusRef) props.focusRef.current = null;
    };
  }, [editor, props.focusRef]);
  return (
    <div className={`rich-composer${props.toolbarVisible ? ' has-toolbar' : ''}`}>
      {editor && (
        <FormattingToolbar
          editor={editor}
          fieldId={fieldId}
          linkButtonId={linkButtonId}
          visible={props.toolbarVisible}
        />
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
