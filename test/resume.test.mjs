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
  mk(d, "feat-x-2026-01-01T00.json", { status: "finished", headSha: "abc" });
  mk(d, "feat-x-2026-01-02T00.json", { status: "in_progress", headSha: "abc" });
  mk(d, "feat-x-2026-01-03T00.json", { status: "in_progress", headSha: "abc" });
  mk(d, "other-2026-01-04T00.json", { status: "in_progress", headSha: "abc" });
  assert.equal(findResumable(d, "feat/x", "abc"), path.join(d, "feat-x-2026-01-03T00.json"));
});
test("findResumable returns null when headSha differs", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dv-"));
  mk(d, "feat-x-2026-01-02T00.json", { status: "in_progress", headSha: "abc" });
  assert.equal(findResumable(d, "feat/x", "zzz"), null);
});
test("findResumable returns null for missing dir", () => {
  assert.equal(findResumable("/nonexistent-dv-dir", "x", "abc"), null);
});
