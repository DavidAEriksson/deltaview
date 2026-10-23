import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createManifest, loadManifest, saveManifest, setItems, applyDecision } from "../skills/deltaview/scripts/lib/manifest.mjs";

const hunk = (id) => ({ id, file: "a.js", oldFile: "a.js", status: "modified", oldStart: 1, newStart: 1, lines: [] });
const mk = () => createManifest({ ref: "pr-1", target: "main", baseSha: "b", headSha: "h", repo: "o/n", pr: null, hunks: [hunk("h1"), hunk("h2")], newEnvVars: [] });
const item = (id, hunkIds, o = {}) => ({ id, tier: "backstage", title: id, route: null, selector: null, chain: [], affects: [], hunkIds, summary: "does a thing", howToReach: null, appearsUnused: false, ...o });
const err = (fn) => { try { fn(); } catch (e) { return e.message; } assert.fail("did not throw"); };

test("createManifest defaults", () => {
  const m = mk();
  assert.equal(m.status, "in_progress");
  assert.deepEqual(m.items, []);
  assert.equal(m.tests, null);
  assert.deepEqual(Object.keys(m.hunks), ["h1", "h2"]);
});

test("setItems rejects uncovered hunk", () => {
  assert.match(err(() => setItems(mk(), [item("i1", ["h1"])])), /h2 not covered/);
});

test("setItems rejects double-covered hunk", () => {
  assert.match(err(() => setItems(mk(), [item("i1", ["h1", "h2"]), item("i2", ["h1"])])), /h1 covered by i1, i2/);
});

test("setItems rejects unknown hunk id", () => {
  assert.match(err(() => setItems(mk(), [item("i1", ["h1", "h2", "h9"])])), /unknown hunk h9/);
});

test("setItems requires route+selector for direct/indirect", () => {
  const msg = err(() => setItems(mk(), [item("i1", ["h1", "h2"], { tier: "direct", route: "/x" })]));
  assert.match(msg, /i1 missing selector/);
});

test("setItems lists all problems one per line", () => {
  const msg = err(() => setItems(mk(), [item("i1", ["h9"], { summary: " " })]));
  assert.ok(msg.split("\n").length >= 3);
});

test("setItems forces visuallyVerified by tier", () => {
  const m = setItems(mk(), [
    item("i1", ["h1"], { visuallyVerified: true }),
    item("i2", ["h2"], { tier: "indirect", route: "/x", selector: "#a", visuallyVerified: false }),
  ]);
  assert.equal(m.items[0].visuallyVerified, false);
  assert.equal(m.items[1].visuallyVerified, true);
  assert.equal(m.items[0].decision, null);
});

test("setItems requires non-empty summary", () => {
  assert.match(err(() => setItems(mk(), [item("i1", ["h1", "h2"], { summary: "  " })])), /i1 missing summary/);
});

test("setItems rejects duplicate item id", () => {
  assert.match(err(() => setItems(mk(), [item("i1", ["h1"]), item("i1", ["h2"])])), /duplicate item id i1/);
});

const ready = () => setItems(mk(), [item("i1", ["h1", "h2"])]);

test("applyDecision sets decidedAt", () => {
  const m = applyDecision(ready(), { itemId: "i1", decision: "approved", comment: "" });
  assert.equal(m.items[0].decision, "approved");
  assert.ok(m.items[0].decidedAt);
});

test("applyDecision null resets the item to undecided", () => {
  const m = applyDecision(applyDecision(ready(), { itemId: "i1", decision: "comment", comment: "c" }), { itemId: "i1", decision: null });
  assert.deepEqual([m.items[0].decision, m.items[0].comment, m.items[0].decidedAt], [null, "", null]);
});

test("applyDecision rejected without reason throws", () => {
  assert.throws(() => applyDecision(ready(), { itemId: "i1", decision: "rejected", comment: "  " }), /reason/);
});

test("applyDecision on finished manifest throws", () => {
  const m = ready();
  m.status = "finished";
  assert.throws(() => applyDecision(m, { itemId: "i1", decision: "approved", comment: "" }), /finished/);
});

test("applyDecision unknown item throws", () => {
  assert.throws(() => applyDecision(ready(), { itemId: "zz", decision: "approved", comment: "" }), /unknown item/);
});

test("saveManifest then loadManifest round-trips and writes .md sibling", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dv-"));
  const p = path.join(dir, "sub", "r.json");
  const m = ready();
  saveManifest(p, m);
  assert.deepEqual(loadManifest(p), m);
  assert.match(await fs.readFile(path.join(dir, "sub", "r.md"), "utf8"), /Deltaview review/);
  assert.deepEqual((await fs.readdir(path.join(dir, "sub"))).sort(), ["r.json", "r.md"]);
});

test("carryDecisions copies decisions for identical edits, flags changed items, never carries binary", async () => {
  const { carryDecisions } = await import("../skills/deltaview/scripts/lib/manifest.mjs");
  const L = (type, text, n) => ({ type, text, oldLine: type === "add" ? null : n, newLine: type === "del" ? null : n });
  const h = (id, file, lines, status = "modified") => ({ id, file, oldFile: file, status, oldStart: 1, newStart: 1, lines });
  const prev = createManifest({ ref: "r", target: "main", baseSha: "b", headSha: "h1", repo: null, hunks: [
    h("h1", "a.js", [L("ctx", "x", 1), L("add", "same", 2)]), h("h2", "b.js", [L("add", "old", 1)]), h("h3", "logo.png", [], "binary"), h("h4", "c.js", [L("add", "c", 1)]),
  ] });
  setItems(prev, [item("i1", ["h1"]), item("i2", ["h2"]), item("i3", ["h3"]), item("i4", ["h4"])]);
  applyDecision(prev, { itemId: "i1", decision: "rejected", comment: "no" });
  applyDecision(prev, { itemId: "i2", decision: "approved" });
  applyDecision(prev, { itemId: "i3", decision: "approved" });
  // same edit in a.js at a new line with new context; b.js edit changed; c.js unchanged but undecided
  const next = createManifest({ ref: "r", target: "main", baseSha: "b", headSha: "h2", repo: null, hunks: [
    h("h1", "a.js", [L("ctx", "y", 7), L("add", "same", 8)]), h("h2", "b.js", [L("add", "new", 1)]), h("h3", "logo.png", [], "binary"), h("h4", "c.js", [L("add", "c", 1)]),
  ] });
  setItems(next, [item("n1", ["h1"]), item("n2", ["h2"]), item("n3", ["h3"]), item("n4", ["h4"])]);
  assert.equal(carryDecisions(next, prev), 1);
  const [n1, n2, n3, n4] = next.items;
  assert.deepEqual([n1.decision, n1.comment, n1.carriedOver, n1.changedSinceReview], ["rejected", "no", true, undefined]);
  assert.deepEqual([n2.decision, n2.changedSinceReview], [null, true]);
  assert.deepEqual([n3.decision, n3.changedSinceReview], [null, true]);
  assert.deepEqual([n4.decision, n4.changedSinceReview, n4.carriedOver], [null, undefined, undefined]);
});
