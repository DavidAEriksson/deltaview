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

export const canSubmit = (decision, comment) =>
  !((decision === "rejected" || decision === "comment") && !String(comment ?? "").trim());
