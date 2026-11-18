export function searchText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

/** Map folded matches back to the original Unicode title for highlighting. */
export function titleMatch(title: string, query: string): { start: number; end: number } | null {
  const needle = searchText(query.trim());
  if (!needle) return null;
  let folded = '';
  const positions: { start: number; end: number }[] = [];
  let offset = 0;
  for (const character of title) {
    const value = searchText(character);
    for (let index = 0; index < value.length; index++)
      positions.push({ start: offset, end: offset + character.length });
    folded += value;
    offset += character.length;
    if (!value && positions.length) positions[positions.length - 1].end = offset;
  }
  const start = folded.indexOf(needle);
  return start < 0
    ? null
    : { start: positions[start].start, end: positions[start + needle.length - 1].end };
}
