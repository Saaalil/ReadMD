export function collectMatches(source: string, query: string): Array<{ from: number; to: number }> {
  const needle = query.trim();
  if (needle.length < 1) return [];
  const matches: Array<{ from: number; to: number }> = [];
  const lower = source.toLowerCase();
  const find = needle.toLowerCase();
  let from = 0;
  while (from < lower.length) {
    const index = lower.indexOf(find, from);
    if (index === -1) break;
    matches.push({ from: index, to: index + needle.length });
    from = index + Math.max(1, needle.length);
    if (matches.length > 400) break;
  }
  return matches;
}
