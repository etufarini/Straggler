const plurals = new Intl.PluralRules('en-US');

export function countLabel(count: number, noun: 'file' | 'chat'): string {
  return `${count} ${noun}${plurals.select(count) === 'one' ? '' : 's'}`;
}
