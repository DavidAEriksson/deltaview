import test from "node:test";
import assert from "node:assert/strict";
import { toBlocks, progress, itemsForPath, canSubmit } from "../skills/deltaview/scripts/overlay/logic.mjs";

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
