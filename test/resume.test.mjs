import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { slug, findResumable } from "../skills/deltaview/scripts/lib/resume.mjs";

const mk = (dir, name, o) => fs.writeFileSync(path.join(dir, name), JSON.stringify(o));

test('slug("feat/some-changes") === "feat-some-changes"', () => {
  assert.equal(slug("feat/some-changes"), "feat-some-changes");
  assert.equal(slug("a//b c"), "a-b-c");
});
test("findResumable picks newest in_progress with matching headSha", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dv-"));
  mk(d, "feat-x-2026-01-01T00.json", { ref: "feat/x", status: "finished", headSha: "abc", items: [{ id: "i1" }] });
  mk(d, "feat-x-2026-01-02T00.json", { ref: "feat/x", status: "in_progress", headSha: "abc", items: [{ id: "i1" }] });
  mk(d, "feat-x-2026-01-03T00.json", { ref: "feat/x", status: "in_progress", headSha: "abc", items: [{ id: "i1" }] });
  mk(d, "other-2026-01-04T00.json", { ref: "other", status: "in_progress", headSha: "abc", items: [{ id: "i1" }] });
  assert.equal(findResumable(d, "feat/x", "abc"), path.join(d, "feat-x-2026-01-03T00.json"));
});
test("findResumable returns null when headSha differs", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dv-"));
  mk(d, "feat-x-2026-01-02T00.json", { ref: "feat/x", status: "in_progress", headSha: "abc", items: [{ id: "i1" }] });
  assert.equal(findResumable(d, "feat/x", "zzz"), null);
});
test("findResumable returns null for missing dir", () => {
  assert.equal(findResumable("/nonexistent-dv-dir", "x", "abc"), null);
});
test("findResumable skips in_progress manifests with no items", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dv-"));
  mk(d, "feat-x-2026-01-02T00.json", { ref: "feat/x", status: "in_progress", headSha: "abc", items: [{ id: "i1" }] });
  mk(d, "feat-x-2026-01-03T00.json", { ref: "feat/x", status: "in_progress", headSha: "abc", items: [] });
  assert.equal(findResumable(d, "feat/x", "abc"), path.join(d, "feat-x-2026-01-02T00.json"));
  fs.rmSync(path.join(d, "feat-x-2026-01-02T00.json"));
  assert.equal(findResumable(d, "feat/x", "abc"), null);
});
test("findResumable ignores manifests of another ref sharing the slug prefix", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dv-"));
  mk(d, "feat-demo-2-2026-01-03T00.json", { ref: "feat/demo-2", status: "in_progress", headSha: "abc", items: [{ id: "i1" }] });
  mk(d, "feat-demo-2026-01-03T00.json", { ref: "feat-demo", status: "in_progress", headSha: "abc", items: [{ id: "i1" }] });
  assert.equal(findResumable(d, "feat/demo", "abc"), null);
});
