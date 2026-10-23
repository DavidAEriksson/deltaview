// Pure overlay logic (no DOM) so it can be tested in node.
export function toBlocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].type;
    let j = i;
    while (j < lines.length && lines[j].type === t) j++;
    if (t === "del" && j < lines.length && lines[j].type === "add") {
      let k = j;
      while (k < lines.length && lines[k].type === "add") k++;
      out.push({ kind: "change", lines: lines.slice(i, k) });
      j = k;
    } else out.push({ kind: t, lines: lines.slice(i, j) });
    i = j;
  }
  return out;
}

export const progress = (items) => ({ done: items.filter((i) => i.decision !== null).length, total: items.length });

const norm = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : p) || "/";
export const itemsForPath = (items, pathname) => items.filter((i) => i.route != null && norm(i.route) === norm(pathname));

// next item after `id` in `step` direction (wrapping) that passes `pick`; never `id` itself
export function nextItem(items, id, step = 1, pick = () => true) {
  const n = items.length, at = items.findIndex((i) => i.id === id);
  const start = at < 0 ? (step > 0 ? -1 : n) : at;
  for (let k = 1; k <= n; k++) {
    const i = items[(((start + step * k) % n) + n) % n];
    if (i.id !== id && pick(i)) return i;
  }
  return null;
}

export const canSubmit = (decision, comment) =>
  !((decision === "rejected" || decision === "comment") && !String(comment ?? "").trim());
