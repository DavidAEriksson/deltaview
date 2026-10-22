import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { renderMarkdown } from "../skills/deltaview/scripts/lib/markdown.mjs";

test("renderMarkdown lists every item with tier, decision, comment, files", () => {
  const m = JSON.parse(fs.readFileSync(new URL("./fixtures/manifest.json", import.meta.url), "utf8"));
  const md = renderMarkdown(m);
  for (const i of m.items) assert.ok(md.includes(i.title), i.title);
  for (const s of ["direct", "indirect", "backstage", "approved", "rejected", "Total wrong", "Check the index", "undecided", "src/a.tsx", "logo.png", "src/old.ts", "not visually verified"])
    assert.ok(md.includes(s), s);
});
