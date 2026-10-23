export function renderMarkdown(m) {
  const out = [`# Deltaview review: ${m.ref}`, "", `Status: ${m.status}`];
  if (m.reviewUrl) out.push(`Review: ${m.reviewUrl}`);
  if (m.tests) out.push(`Tests: \`${m.tests.command}\` ${m.tests.passed ? "passed" : "FAILED"} (${m.tests.summary})`);
  if (m.newEnvVars?.length) out.push(`New env vars: ${m.newEnvVars.join(", ")}`);
  for (const it of m.items) {
    const files = [...new Set(it.hunkIds.map((id) => m.hunks[id]).filter(Boolean).map((h) => h.file))];
    out.push("", `## ${it.title}`, `- Tier: ${it.tier}${it.tier === "backstage" ? " (not visually verified)" : ""}`,
      `- Decision: ${it.decision ?? "undecided"}${it.carriedOver ? " (carried over from the last review)" : ""}`);
    if (it.changedSinceReview) out.push("- Changed since the last review");
    if (it.comment) out.push(`- Comment: ${it.comment}`);
    out.push(`- Files: ${files.join(", ")}`, "", it.summary);
  }
  return out.join("\n") + "\n";
}
