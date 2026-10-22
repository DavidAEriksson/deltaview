// Parses `git diff` output into Hunk[] (see shared types). Paths with spaces in binary diffs are unsupported.
export function parseDiff(text) {
  const hunks = [];
  const push = (h) => hunks.push({ id: `h${hunks.length + 1}`, ...h });
  for (const block of text.split(/^diff --git /m).slice(1)) {
    const lines = block.split("\n");
    const m = lines[0].match(/^a\/(.+) b\/(.+)$/);
    let oldFile = m?.[1], file = m?.[2], status = "modified", binary = false;
    let i = 1;
    for (; i < lines.length && !lines[i].startsWith("@@"); i++) {
      const l = lines[i];
      if (l.startsWith("new file")) status = "added";
      else if (l.startsWith("deleted file")) status = "deleted";
      else if (l.startsWith("rename from ")) { status = "renamed"; oldFile = l.slice(12); }
      else if (l.startsWith("rename to ")) file = l.slice(10);
      else if (l.startsWith("Binary files") || l.startsWith("GIT binary patch")) binary = true;
    }
    if (status === "deleted") file = oldFile;
    if (binary) { push({ file, oldFile, status: "binary", oldStart: 0, newStart: 0, lines: [] }); continue; }
    const before = hunks.length;
    let cur = null, o = 0, n = 0;
    for (; i < lines.length; i++) {
      const l = lines[i];
      const hh = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hh) {
        o = +hh[1]; n = +hh[2];
        cur = { file, oldFile, status, oldStart: o, newStart: n, lines: [] };
        push(cur);
      } else if (!cur || l.startsWith("\\")) continue;
      else if (l[0] === "+") cur.lines.push({ type: "add", text: l.slice(1), oldLine: null, newLine: n++ });
      else if (l[0] === "-") cur.lines.push({ type: "del", text: l.slice(1), oldLine: o++, newLine: null });
      else if (l[0] === " ") cur.lines.push({ type: "ctx", text: l.slice(1), oldLine: o++, newLine: n++ });
    }
    // pure rename / mode-only / empty file: no @@ hunk, but the file must still be covered by an item
    if (hunks.length === before) push({ file, oldFile, status, oldStart: 0, newStart: 0, lines: [] });
  }
  return hunks;
}
