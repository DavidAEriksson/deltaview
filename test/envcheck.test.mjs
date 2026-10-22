import { test } from "node:test";
import assert from "node:assert/strict";
import { newEnvVars } from "../skills/deltaview/scripts/lib/envcheck.mjs";

const base = { baseExample: "A=1\n", headExample: "A=1\n", addedLines: [], removedLines: [] };

test("new key in .env.example is reported", () => {
  assert.deepEqual(newEnvVars({ ...base, headExample: "A=1\nB=2\n# C=3\nexport D=4\n" }), ["B", "D"]);
});
test("existing key not reported", () => {
  assert.deepEqual(newEnvVars(base), []);
});
test("process.env.FOO and import.meta.env.VITE_BAR in added lines reported", () => {
  assert.deepEqual(newEnvVars({ ...base, addedLines: ["const a = process.env.FOO;", 'x(process.env["Q"], import.meta.env.VITE_BAR)', "process.env.A"] }),
    ["FOO", "Q", "VITE_BAR"]);
});
test("var present in removed lines (rename of usage) not reported", () => {
  assert.deepEqual(newEnvVars({ ...base, addedLines: ["process.env.FOO"], removedLines: ["process.env.FOO"] }), []);
});
