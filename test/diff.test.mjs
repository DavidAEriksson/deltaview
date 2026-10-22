import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseDiff } from "../skills/deltaview/scripts/lib/diff.mjs";

const hunks = parseDiff(fs.readFileSync(new URL("./fixtures/sample.diff", import.meta.url), "utf8"));
const byFile = (f) => hunks.filter((h) => h.file === f);

test("parses modified file into 2 hunks with correct line numbers", () => {
  const hs = byFile("src/a.js");
  assert.equal(hs.length, 2);
  assert.deepEqual(hunks.map((h) => h.id), ["h1", "h2", "h3", "h4", "h5", "h6"]);
  assert.equal(hs[0].lines.find((l) => l.type === "add").newLine, 2);
  assert.equal(hs[0].lines.find((l) => l.type === "del").oldLine, 2);
  assert.deepEqual(hs[0].lines[0], { type: "ctx", text: "one", oldLine: 1, newLine: 1 });
  assert.equal(hs[1].lines.find((l) => l.type === "add").newLine, 13);
  assert.equal(hs[1].newStart, 11);
});

test("added file: all lines add, status added", () => {
  const [h] = byFile("src/new.js");
  assert.equal(h.status, "added");
  assert.ok(h.lines.every((l) => l.type === "add"));
});

test("deleted file: status deleted, all del with oldLine", () => {
  const [h] = byFile("src/gone.js");
  assert.equal(h.status, "deleted");
  assert.equal(h.oldFile, h.file);
  assert.deepEqual(h.lines.map((l) => l.oldLine), [1, 2]);
  assert.ok(h.lines.every((l) => l.type === "del"));
});

test("rename: file is new path, oldFile is old path, status renamed", () => {
  const [h] = byFile("src/new-name.js");
  assert.equal(h.oldFile, "src/old-name.js");
  assert.equal(h.status, "renamed");
});

test("binary: one hunk, status binary, lines empty", () => {
  const hs = byFile("img/logo.png");
  assert.equal(hs.length, 1);
  assert.equal(hs[0].status, "binary");
  assert.deepEqual(hs[0].lines, []);
});

test('ignores "\\ No newline at end of file"', () => {
  const [h] = byFile("src/new.js");
  assert.equal(h.lines.length, 2);
  assert.ok(h.lines.every((l) => !l.text.startsWith("\\")));
});
