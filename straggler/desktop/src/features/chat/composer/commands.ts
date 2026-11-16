import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { parseMarkdown, serializeMarkdown } from './markdown';

export type FormattingAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'link'
  | 'orderedList'
  | 'bulletList'
  | 'blockquote'
  | 'code'
  | 'codeBlock';
export type ComposerContext = 'text' | 'list' | 'code';
export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
export const modifierLabel = () => (isMac() ? '⌘' : 'Ctrl');

export function focusComposer(editor: Editor, atEnd = false) {
  if (editor.isDestroyed) return;
  if (atEnd)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)));
  // TipTap's Safari focus command focuses twice. Its delayed second focus can
  // steal the next Tab after toolbar Escape or a popover closes.
  editor.view.focus();
}

export function composerContext(editor: Editor): ComposerContext {
  return editor.isActive('codeBlock') ? 'code' : editor.isActive('listItem') ? 'list' : 'text';
}

export function formattingDisabled(editor: Editor, action: FormattingAction): boolean {
  return (
    !editor.isEditable ||
    (editor.isActive('codeBlock') && action !== 'codeBlock') ||
    (editor.isActive('code') && ['bold', 'italic', 'strike', 'link'].includes(action))
  );
}

export function applyFormatting(editor: Editor, action: FormattingAction, openLink: () => void) {
  if (formattingDisabled(editor, action)) return;
  focusComposer(editor);
  const chain = editor.chain();
  switch (action) {
    case 'bold':
      chain.toggleBold().run();
      break;
    case 'italic':
      chain.toggleItalic().run();
      break;
    case 'strike':
      chain.toggleStrike().run();
      break;
    case 'code':
      chain.toggleCode().run();
      break;
    case 'blockquote':
      chain.toggleBlockquote().run();
      break;
    case 'orderedList':
      chain.toggleOrderedList().run();
      break;
    case 'bulletList':
      chain.toggleBulletList().run();
      break;
    case 'codeBlock':
      chain.toggleCodeBlock().run();
      break;
    case 'link':
      openLink();
      break;
  }
}

function exitCode(editor: Editor, removeTrailingLine: boolean) {
  const { $from } = editor.state.selection;
  const chain = editor.chain();
  if (removeTrailingLine && $from.parent.textContent.endsWith('\n'))
    chain.deleteRange({ from: $from.pos - 1, to: $from.pos });
  chain.exitCode().run();
}

export function handleComposerKey(
  editor: Editor,
  event: KeyboardEvent,
  { submit, editing, openLink }: { submit: () => void; editing: boolean; openLink: () => void },
): boolean {
  if (event.isComposing || editor.view.composing || event.keyCode === 229) return false;
  const mod = isMac() ? event.metaKey : event.ctrlKey;
  const context = composerContext(editor);
  const { selection } = editor.state;
  const { $from, empty } = selection;
  let action: FormattingAction | undefined;
  if (mod) {
    if (event.shiftKey) {
      const actions: Record<string, FormattingAction> = {
        KeyX: 'strike',
        KeyU: 'link',
        Digit7: 'orderedList',
        Digit8: 'bulletList',
        Digit9: 'blockquote',
        KeyC: event.altKey ? 'codeBlock' : 'code',
      };
      if (!event.altKey || event.code === 'KeyC') action = actions[event.code];
    } else if (!event.altKey) {
      if (event.code === 'KeyB') action = 'bold';
      if (event.code === 'KeyI') action = 'italic';
    }
    if (action) {
      event.preventDefault();
      applyFormatting(editor, action, openLink);
      return true;
    }
    if (event.code === 'KeyU' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      return true;
    }
    if (event.code === 'KeyZ' && !event.altKey) {
      event.preventDefault();
      if (event.shiftKey) editor.commands.redo();
      else editor.commands.undo();
      return true;
    }
    if (event.code === 'KeyY' && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      editor.commands.redo();
      return true;
    }
    if (event.code === 'KeyF' && event.shiftKey && !event.altKey) {
      event.preventDefault();
      if (context !== 'code') {
        editor.commands.setContent(parseMarkdown(serializeMarkdown(editor.getJSON(), false)));
        focusComposer(editor, true);
      }
      return true;
    }
  }
  if (event.code === 'Enter' || event.code === 'NumpadEnter') {
    event.preventDefault();
    if (mod || (!editing && !event.shiftKey && context !== 'code')) {
      submit();
    } else if (context === 'code') {
      const atEnd = empty && $from.parentOffset === $from.parent.content.size;
      if (atEnd && (!$from.parent.textContent || $from.parent.textContent.endsWith('\n')))
        exitCode(editor, true);
      else editor.commands.insertContent({ type: 'text', text: '\n' });
    } else if (context === 'list') {
      if (!$from.parent.textContent) editor.commands.liftListItem('listItem');
      else editor.commands.splitListItem('listItem');
    } else if (editor.isActive('blockquote')) {
      if (!$from.parent.textContent) editor.commands.lift('blockquote');
      else editor.commands.splitBlock();
    } else {
      editor.commands.splitBlock();
    }
    return true;
  }
  if (event.code === 'Tab') {
    if (context !== 'list') return false;
    event.preventDefault();
    if (event.shiftKey) editor.commands.liftListItem('listItem');
    else editor.commands.sinkListItem('listItem');
    return true;
  }
  if (event.code === 'Backspace' && empty && $from.parentOffset === 0) {
    if (context === 'code' || editor.isActive('blockquote')) {
      event.preventDefault();
      if (context === 'code') editor.commands.setParagraph();
      else editor.commands.lift('blockquote');
      return true;
    }
  }
  if (
    event.code === 'ArrowDown' &&
    context === 'code' &&
    empty &&
    $from.parentOffset === $from.parent.content.size &&
    $from.after() === editor.state.doc.content.size
  ) {
    event.preventDefault();
    exitCode(editor, false);
    return true;
  }
  return false;
}

export function pastePlainText(editor: Editor, event: ClipboardEvent): boolean {
  if (!event.clipboardData) return false;
  const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
  event.preventDefault();
  if (!text) return true;
  const { state } = editor;
  if (editor.isActive('codeBlock') || editor.isActive('code')) {
    editor.view.dispatch(state.tr.insertText(text));
  } else {
    const content = text
      .split('\n')
      .flatMap((line, index) => [
        ...(index ? [state.schema.nodes.hardBreak.create()] : []),
        ...(line ? [state.schema.text(line)] : []),
      ]);
    const tr = state.tr.replaceWith(state.selection.from, state.selection.to, content);
    tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(state.selection.to))));
    editor.view.dispatch(tr.scrollIntoView());
  }
  return true;
}
