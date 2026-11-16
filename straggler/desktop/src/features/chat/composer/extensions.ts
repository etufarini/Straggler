import { markInputRule, textblockTypeInputRule, wrappingInputRule } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Strike from '@tiptap/extension-strike';
import Code from '@tiptap/extension-code';
import CodeBlock from '@tiptap/extension-code-block';
import Blockquote from '@tiptap/extension-blockquote';
import { BulletList, OrderedList, ListItem } from '@tiptap/extension-list';
import HardBreak from '@tiptap/extension-hard-break';
import Link from '@tiptap/extension-link';
import { UndoRedo, Placeholder } from '@tiptap/extensions';
import { normalizeComposerUrl } from './markdown';

const ComposerBold = Bold.extend({
  addKeyboardShortcuts: () => ({}),
  addInputRules() {
    return [
      /(?<![\p{L}\p{N}_\\*])\*\*([^\s*](?:[^*]*[^\s*])?)\*\*$/u,
      /(?<![\p{L}\p{N}_\\*])\*([^\s*](?:[^*]*[^\s*])?)\*$/u,
    ].map((find) => markInputRule({ find, type: this.type }));
  },
});
const ComposerItalic = Italic.extend({
  addKeyboardShortcuts: () => ({}),
  addInputRules() {
    return [
      markInputRule({ find: /(?<![\p{L}\p{N}_\\])_([^\s_](?:[^_]*[^\s_])?)_$/u, type: this.type }),
    ];
  },
});
const ComposerStrike = Strike.extend({
  addKeyboardShortcuts: () => ({}),
  addInputRules() {
    return [
      /(?<![\p{L}\p{N}_\\~])~~([^\s~](?:[^~]*[^\s~])?)~~$/u,
      /(?<![\p{L}\p{N}_\\~])~([^\s~](?:[^~]*[^\s~])?)~$/u,
    ].map((find) => markInputRule({ find, type: this.type }));
  },
});
const ComposerCode = Code.extend({
  addKeyboardShortcuts: () => ({}),
  addInputRules() {
    return [markInputRule({ find: /(?<![\p{L}\p{N}_\\`])`([^`]+)`$/u, type: this.type })];
  },
});
const ComposerCodeBlock = CodeBlock.extend({
  addKeyboardShortcuts: () => ({}),
  addInputRules() {
    return [textblockTypeInputRule({ find: /^```$/, type: this.type })];
  },
  // Pasting, including VS Code clipboard metadata, always follows the plain-text policy.
  addProseMirrorPlugins: () => [],
});
const ComposerQuote = Blockquote.extend({
  addKeyboardShortcuts: () => ({}),
  addInputRules() {
    return [wrappingInputRule({ find: /^> $/, type: this.type })];
  },
});
const ComposerBulletList = BulletList.extend({
  addKeyboardShortcuts: () => ({}),
  addInputRules() {
    return [wrappingInputRule({ find: /^[-*] $/, type: this.type })];
  },
});
const ComposerOrderedList = OrderedList.extend({
  addKeyboardShortcuts: () => ({}),
  addInputRules() {
    return [wrappingInputRule({ find: /^1\. $/, type: this.type })];
  },
});

export function composerExtensions(placeholder: () => string) {
  return [
    Document,
    Paragraph,
    Text,
    ComposerBold,
    ComposerItalic,
    ComposerStrike,
    ComposerCode,
    ComposerCodeBlock,
    ComposerQuote,
    ComposerBulletList,
    ComposerOrderedList,
    ListItem.extend({ addKeyboardShortcuts: () => ({}) }),
    HardBreak.extend({ addKeyboardShortcuts: () => ({}) }),
    Link.configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      protocols: ['http', 'https'],
      isAllowedUri: (url) => normalizeComposerUrl(url) !== null,
    }),
    UndoRedo.extend({ addKeyboardShortcuts: () => ({}) }),
    Placeholder.configure({ placeholder, showOnlyWhenEditable: false }),
  ];
}
