import { execFile } from "node:child_process";

const hasEdit = (h) => h.lines.some((l) => l.type !== "ctx");
const pathOf = (h) => (h.status === "deleted" ? h.oldFile : h.file);

function anchor(h) {
  const adds = h.lines.filter((l) => l.type === "add");
  const [side, key, ls] = adds.length ? ["RIGHT", "newLine", adds] : ["LEFT", "oldLine", h.lines.filter((l) => l.type === "del")];
  const first = ls[0][key], line = ls.at(-1)[key];
  return { line, side, ...(first !== line && { start_line: first, start_side: side }) };
}

function commentBody(it, others) {
  let b = it.decision === "rejected" ? `❌ Rejected: ${it.comment}` : `💬 ${it.comment}`;
  if (it.tier === "backstage") b += "\n\n_Not visually verified._";
  if (others.length) b += `\n\nAlso covers: ${others.join(", ")}`;
  return b;
}

export function buildReview(m) {
  const count = (d) => m.items.filter((i) => i.decision === d).length;
  const undecided = m.items.filter((i) => !i.decision);
  const rejected = m.items.filter((i) => i.decision === "rejected");
  const event = m.pr?.isAuthor ? "COMMENT"
    : rejected.length ? "REQUEST_CHANGES"
    : m.items.length && count("approved") === m.items.length ? "APPROVE" : "COMMENT";

  const comments = [];
  const bodyOnly = [];
  for (const it of m.items) {
    const hunks = it.hunkIds.map((id) => m.hunks[id]);
    const first = hunks.find(hasEdit);
    if (!first) { bodyOnly.push(it); continue; }
    // approvals go in the body only: one inline "approved" per item is noise on the PR
    if (!it.decision || it.decision === "approved") continue;
    const at = it.line && m.hunks[it.line.hunkId], l = at?.lines[it.line.index];
    const p = pathOf(at || first);
    const others = [...new Set(hunks.map(pathOf))].filter((f) => f !== p);
    comments.push({ path: p, body: commentBody(it, others), ...(l ? (l.type === "del" ? { line: l.oldLine, side: "LEFT" } : { line: l.newLine, side: "RIGHT" }) : anchor(first)) });
  }

  const lines = ["## Deltaview review", "",
    `${count("approved")} approved, ${count("rejected")} rejected, ${count("comment")} commented, ${undecided.length} not reviewed of ${m.items.length} items.`];
  if (m.tests) lines.push("", `Tests: \`${m.tests.command}\` ${m.tests.passed ? "passed" : "FAILED"} (${m.tests.summary})`);
  if (m.newEnvVars?.length) lines.push("", `New env vars: ${m.newEnvVars.join(", ")}`);
  const approved = m.items.filter((i) => i.decision === "approved" && !bodyOnly.includes(i));
  if (approved.length) lines.push("", "### Approved", ...approved.map((i) => `- ${i.title}${i.tier === "backstage" ? " _(not visually verified)_" : ""}`));
  if (rejected.length) lines.push("", "### Rejections", ...rejected.map((i) => `- ${i.title}: ${i.comment}`));
  if (undecided.length) lines.push("", "### Not reviewed", ...undecided.map((i) => `- ${i.title}`));
  if (bodyOnly.length) lines.push("", "### Binary / no line changes (no inline comment)", ...bodyOnly.map((i) => `- ${i.title}${i.decision ? ` (${i.decision}${i.comment ? `: ${i.comment}` : ""})` : ""}`));
  if (m.pr?.isAuthor) lines.push("", "Posted as COMMENT because GitHub doesn't allow approving or requesting changes on your own PR.");
  return { event, body: lines.join("\n"), comments };
}

export const defaultRun = (cmd, args, input) =>
  new Promise((resolve, reject) => {
    const p = execFile(cmd, args, (err, stdout, stderr) =>
      err ? reject(new Error(stderr?.trim() || err.message)) : resolve({ stdout }));
    p.stdin.on("error", () => {}); // EPIPE if gh exits early; the exit callback reports the error
    p.stdin.end(input);
  });

export async function postReview(m, run = defaultRun) {
  const review = buildReview(m);
  // a failed lookup must not block posting the review
  const head = await run("gh", ["api", `repos/${m.repo}/pulls/${m.pr.number}`, "-q", ".head.sha"]).then((r) => r.stdout.trim(), () => m.headSha);
  if (head !== m.headSha) review.body += `\n\n⚠ Reviewed at ${m.headSha.slice(0, 7)}; the PR head has since moved to ${head.slice(0, 7)}. Inline comments may show as outdated.`;
  const payload = JSON.stringify({ commit_id: m.headSha, ...review });
  const { stdout } = await run("gh", ["api", `repos/${m.repo}/pulls/${m.pr.number}/reviews`, "--method", "POST", "--input", "-"], payload);
  return { url: JSON.parse(stdout).html_url };
}
