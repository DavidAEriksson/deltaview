const keys = (t) => [...t.matchAll(/^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=/gm)].map((m) => m[1]);
const used = (lines) => lines.flatMap((l) =>
  [...l.matchAll(/process\.env\.(\w+)|process\.env\[["'](\w+)["']\]|import\.meta\.env\.(\w+)/g)].map((m) => m[1] ?? m[2] ?? m[3]));

// shortcut: an existing var newly referenced but absent from .env.example is reported as new; upgrade by scanning the base tree if false positives annoy reviewers
export function newEnvVars({ baseExample, headExample, addedLines, removedLines }) {
  const base = new Set(keys(baseExample)), removed = new Set(used(removedLines));
  return [...new Set([
    ...keys(headExample).filter((k) => !base.has(k)),
    ...used(addedLines).filter((k) => !base.has(k) && !removed.has(k)),
  ])].sort();
}
