export function buildIncludedThemeIds(themeRows, rootIds) {
  const children = new Map();
  for (const t of themeRows) {
    const parent = t.parent_id === '' || t.parent_id == null ? null : Number(t.parent_id);
    if (parent != null) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(Number(t.id));
    }
  }
  const included = new Set();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop();
    if (included.has(id)) continue;
    included.add(id);
    for (const c of children.get(id) || []) stack.push(c);
  }
  return included;
}
