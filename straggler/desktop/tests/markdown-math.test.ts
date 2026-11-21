import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import type { Root, RootContent } from 'mdast';
import { remarkLatexDelimiters } from '../src/domain/markdownMath';

function parse(source: string) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkMath, { singleDollarTextMath: false })
    .use(remarkLatexDelimiters);
  return processor.runSync(processor.parse(source), { value: source }) as Root;
}
function nodes(tree: Root | RootContent): (Root | RootContent)[] {
  return [tree, ...('children' in tree ? tree.children.flatMap(nodes) : [])];
}
function formulas(source: string) {
  return nodes(parse(source)).filter((node) => node.type === 'math' || node.type === 'inlineMath');
}

describe('LaTeX delimiters in Markdown text', () => {
  it('recognizes text delimiters with literal LaTeX syntax and displays double dollars as blocks', () => {
    const inline = formulas(String.raw`Before \(a_b * \frac{1}{2}\) after`);
    expect(inline).toHaveLength(1);
    expect(inline[0]).toMatchObject({
      type: 'inlineMath',
      value: String.raw`a_b * \frac{1}{2}`,
      data: { hProperties: { dataMathDisplay: false } },
    });
    expect(formulas(String.raw`\[\sum_{i=1}^n x_i\]`)[0]).toMatchObject({
      data: { hProperties: { dataMathDisplay: true } },
    });
    expect(formulas('$$x^2$$')[0]).toMatchObject({
      data: { hProperties: { dataMathDisplay: true } },
    });
    expect(formulas('$$\nx^2\n$$')[0]).toMatchObject({
      data: { hProperties: { className: ['math-formula'] } },
    });
    expect(formulas('\\[\na_b + c\n\\]')[0]).toMatchObject({ value: '\na_b + c\n' });
  });

  it('keeps inline and fenced code, escaped delimiters and single-dollar prices literal', () => {
    const source =
      String.raw`Pay $20 or $30; $single$ and \\(escaped\\).` +
      '\n\n' +
      '`\\(code\\)`\n\n```math\n\\[code\\]\n$$x$$\n```';
    expect(formulas(source)).toHaveLength(0);
    const tree = nodes(parse(source));
    expect(tree.find((node) => node.type === 'inlineCode')).toMatchObject({
      value: String.raw`\(code\)`,
    });
    expect(tree.find((node) => node.type === 'code')).toMatchObject({
      lang: 'math',
      value: '\\[code\\]\n$$x$$',
    });
    expect(tree.find((node) => node.type === 'text')).toMatchObject({
      value: String.raw`Pay $20 or $30; $single$ and \(escaped\).`,
    });
  });

  it('holds unfinished stream formulas as muted source until they close', () => {
    expect(formulas('$$\nx^2')[0]).toMatchObject({
      data: {
        hProperties: { className: ['math-pending'] },
        hChildren: [{ type: 'text', value: '$$\nx^2' }],
      },
    });
    expect(
      nodes(parse(String.raw`Still \(x^2`)).some(
        (node) =>
          node.type === 'text' &&
          node.value.includes('\\(x^2') &&
          node.data?.hProperties?.className?.includes('math-pending'),
      ),
    ).toBe(true);
    expect(formulas(String.raw`Still \(x^2\)`)[0]).toMatchObject({
      value: 'x^2',
      data: { hProperties: { className: ['math-formula'] } },
    });
  });
});
