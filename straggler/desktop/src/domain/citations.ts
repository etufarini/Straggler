import type { WebSource } from './webSearch';

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}
export function citationPlugin(
  sources: WebSource[],
  projectSources: { n: number }[] = [],
  attachmentSources: { n: number }[] = [],
) {
  const numbers = new Set(sources.map((source) => String(source.n)));
  for (const source of projectSources) numbers.add(`P${source.n}`);
  for (const source of attachmentSources) numbers.add(`A${source.n}`);
  return () => (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (
        ['link', 'linkReference', 'code', 'inlineCode', 'image', 'imageReference'].includes(
          node.type,
        ) ||
        !node.children
      )
        return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== 'text' || !child.value) {
          visit(child);
          return [child];
        }
        const parts: MarkdownNode[] = [];
        let offset = 0;
        for (const match of child.value.matchAll(/\[([PA]?\d+)\]/g)) {
          const n = match[1];
          if (!numbers.has(n)) continue;
          const index = match.index!;
          if (index > offset) parts.push({ type: 'text', value: child.value.slice(offset, index) });
          parts.push({
            type: 'link',
            url: `#straggler-source-${n}`,
            children: [{ type: 'text', value: String(n) }],
          });
          offset = index + match[0].length;
        }
        if (!parts.length) return [child];
        if (offset < child.value.length)
          parts.push({ type: 'text', value: child.value.slice(offset) });
        return parts;
      });
    }
    visit(tree);
  };
}
