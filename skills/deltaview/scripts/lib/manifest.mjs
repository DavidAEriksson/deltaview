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
    decision: null, comment: "", decidedAt: null,
  }));
  return manifest;
}

export function applyDecision(manifest, { itemId, decision, comment = "" }) {
  if (manifest.status === "finished") throw new Error("review is finished");
  const it = manifest.items.find((i) => i.id === itemId);
  if (!it) throw new Error(`unknown item ${itemId}`);
  if (!DECISIONS.includes(decision)) throw new Error(`invalid decision ${decision}`);
  if (decision === "rejected" && !comment.trim()) throw new Error("rejecting requires a reason");
  Object.assign(it, { decision, comment, decidedAt: new Date().toISOString() });
  return manifest;
}
