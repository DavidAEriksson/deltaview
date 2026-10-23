import test from "node:test";
import assert from "node:assert/strict";
import { toBlocks, progress, itemsForPath, canSubmit, nextItem, changeSpan } from "../skills/deltaview/scripts/overlay/logic.mjs";

test("changeSpan marks whole changed words, keeps shared prefix/suffix", () => {
  const mid = (a, b) => { const [p, s] = changeSpan(a, b); return [a.slice(p, a.length - s), b.slice(p, b.length - s)]; };
  assert.deepEqual(mid("const total = sum(a);", "const total = sum(b);"), ["a", "b"]);
  assert.deepEqual(mid("color: red;", "color: green;"), ["red", "green"]);
  assert.deepEqual(mid("fooBar()", "fooBaz()"), ["fooBar", "fooBaz"]);
  assert.deepEqual(mid("x", "x"), ["", ""]);
  assert.deepEqual(mid("abc", "xyz"), ["abc", "xyz"]);
  assert.deepEqual(mid("a(1)", "a(1, 2)"), ["", ", 2"]);
});

test("nextItem steps and wraps both ways, starts at an end with no current", () => {
  const items = ["a", "b", "c"].map((id) => ({ id }));
  const at = (id, step) => nextItem(items, id, step)?.id;
  assert.deepEqual([at("a", 1), at("c", 1), at("a", -1), at(null, 1), at(null, -1)], ["b", "a", "c", "a", "c"]);
});

test("nextItem filters with pick and returns null when only the current one matches", () => {
  const items = [{ id: "a", decision: null }, { id: "b", decision: "approved" }, { id: "c", decision: null }];
  const undecided = (i) => !i.decision;
  assert.equal(nextItem(items, "a", 1, undecided).id, "c");
  assert.equal(nextItem(items, "c", 1, undecided).id, "a");
  assert.equal(nextItem([items[0]], "a", 1, undecided), null);
  assert.equal(nextItem([], null), null);
});

const L = (type, text = "x") => ({ type, text });

test("del run followed by add run → single change block", () => {
  const b = toBlocks([L("del", "a"), L("del", "b"), L("add", "c")]);
  assert.equal(b.length, 1);
  assert.equal(b[0].kind, "change");
  assert.deepEqual(b[0].lines.map((l) => l.text), ["a", "b", "c"]);
});

test("lone add → add block; lone del → del block; ctx separates blocks", () => {
  assert.deepEqual(toBlocks([L("add")]).map((b) => b.kind), ["add"]);
  assert.deepEqual(toBlocks([L("del")]).map((b) => b.kind), ["del"]);
  assert.deepEqual(toBlocks([L("add"), L("ctx"), L("add"), L("del"), L("ctx"), L("del")]).map((b) => b.kind),
    ["add", "ctx", "add", "del", "ctx", "del"]);
  assert.deepEqual(toBlocks([L("add"), L("del")]).map((b) => b.kind), ["add", "del"]);
});

test("progress counts decided items", () => {
  assert.deepEqual(progress([{ decision: null }, { decision: "approved" }, { decision: "comment" }]), { done: 2, total: 3 });
});

test("itemsForPath normalizes trailing slash", () => {
  const items = [{ id: "a", route: "/orders" }, { id: "b", route: "/" }, { id: "c", route: null }];
  assert.deepEqual(itemsForPath(items, "/orders/").map((i) => i.id), ["a"]);
  assert.deepEqual(itemsForPath(items, "/").map((i) => i.id), ["b"]);
});

test("canSubmit: approved with empty comment true; rejected with '  ' false; comment with text true", () => {
  assert.equal(canSubmit("approved", ""), true);
  assert.equal(canSubmit("rejected", "  "), false);
  assert.equal(canSubmit("rejected", "bad"), true);
  assert.equal(canSubmit("comment", "  "), false);
  assert.equal(canSubmit("comment", "hi"), true);
});
