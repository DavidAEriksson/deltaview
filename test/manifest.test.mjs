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
