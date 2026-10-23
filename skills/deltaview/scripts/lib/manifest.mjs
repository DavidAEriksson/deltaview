import fs from "node:fs";
import path from "node:path";
import { renderMarkdown } from "./markdown.mjs";

const TIERS = ["direct", "indirect", "backstage"];
const DECISIONS = ["approved", "rejected", "comment"];

export function createManifest({ ref, target, baseSha, headSha, repo, pr = null, hunks, newEnvVars = [] }) {
  return {
    version: 1, ref, target, baseSha, headSha, repo, pr, tests: null, newEnvVars,
    hunks: Object.fromEntries(hunks.map((h) => [h.id, h])),
    items: [], status: "in_progress", reviewUrl: null, error: null,
    createdAt: new Date().toISOString(),
  };
}

export const loadManifest = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

export function saveManifest(p, manifest) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p + ".tmp", JSON.stringify(manifest, null, 2));
  fs.renameSync(p + ".tmp", p);
  const md = p.replace(/\.json$/, ".md");
  fs.writeFileSync(md + ".tmp", renderMarkdown(manifest));
  fs.renameSync(md + ".tmp", md);
}

export function setItems(manifest, items) {
  const problems = [];
  const covered = {}, ids = new Set();
  for (const it of items) {
    if (ids.has(it.id)) problems.push(`duplicate item id ${it.id}`);
    ids.add(it.id);
    if (!TIERS.includes(it.tier)) problems.push(`${it.id} invalid tier ${it.tier}`);
    if (!it.summary?.trim()) problems.push(`${it.id} missing summary`);
    if (it.tier === "direct" || it.tier === "indirect") {
      if (!it.route) problems.push(`${it.id} missing route`);
      if (!it.selector) problems.push(`${it.id} missing selector`);
    }
    for (const h of it.hunkIds ?? []) {
      if (!manifest.hunks[h]) problems.push(`unknown hunk ${h} in ${it.id}`);
      else (covered[h] ??= []).push(it.id);
    }
  }
  for (const h of Object.keys(manifest.hunks)) {
    if (!covered[h]) problems.push(`${h} not covered`);
    else if (covered[h].length > 1) problems.push(`${h} covered by ${covered[h].join(", ")}`);
  }
  if (problems.length) throw new Error(problems.join("\n"));
  manifest.items = items.map((it) => ({
    ...it,
    visuallyVerified: it.tier !== "backstage",
    decision: null, comment: "", decidedAt: null, line: null,
  }));
  return manifest;
}

// line: {hunkId, index} into that hunk's lines, the line a rejection or comment is about; null = the item's first change
export function applyDecision(manifest, { itemId, decision, comment = "", line = null }) {
  if (manifest.status === "finished") throw new Error("review is finished");
  const it = manifest.items.find((i) => i.id === itemId);
  if (!it) throw new Error(`unknown item ${itemId}`);
  // null resets the item to undecided
  if (decision === null) return Object.assign(it, { decision: null, comment: "", decidedAt: null, line: null }), manifest;
  if (!DECISIONS.includes(decision)) throw new Error(`invalid decision ${decision}`);
  if (decision === "rejected" && !comment.trim()) throw new Error("rejecting requires a reason");
  if (line != null && !(it.hunkIds.includes(line.hunkId) && Number.isInteger(line.index) && manifest.hunks[line.hunkId].lines[line.index])) throw new Error("invalid line");
  // approvals get no inline comment, so they have no line
  Object.assign(it, { decision, comment, decidedAt: new Date().toISOString(), line: decision === "approved" ? null : line });
  return manifest;
}

// content of a hunk's edits, without line numbers or context, so moved-but-unchanged code still matches; binary content is unknown
const hunkKey = (h) => (h.status === "binary" ? null : JSON.stringify([h.file, h.oldFile, h.status, h.lines.filter((l) => l.type !== "ctx").map((l) => l.type[0] + l.text)]));
const itemKey = (m, it) => { const ks = it.hunkIds.map((id) => hunkKey(m.hunks[id])); return ks.includes(null) ? null : ks.sort().join("\n"); };

// a line index only means the same line if the whole hunk, context included, is unchanged
const sameText = (h) => JSON.stringify(h.lines.map((l) => [l.type, l.text]));
const carryLine = (m, it, prev, line) => {
  const id = line && it.hunkIds.find((h) => m.hunks[h].file === prev.hunks[line.hunkId].file && sameText(m.hunks[h]) === sameText(prev.hunks[line.hunkId]));
  return id ? { hunkId: id, index: line.index } : null;
};

// copies decisions from an earlier review onto items whose edits are byte-identical; flags items with no identical counterpart
export function carryDecisions(manifest, prev) {
  const old = new Map(prev.items.map((i) => [itemKey(prev, i), i]));
  old.delete(null);
  let carried = 0;
  for (const it of manifest.items) {
    const o = old.get(itemKey(manifest, it));
    if (!o) it.changedSinceReview = true;
    else if (o.decision) { Object.assign(it, { decision: o.decision, comment: o.comment, decidedAt: o.decidedAt, line: carryLine(manifest, it, prev, o.line), carriedOver: true }); carried++; }
  }
  return carried;
}
