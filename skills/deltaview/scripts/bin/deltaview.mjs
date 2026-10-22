#!/usr/bin/env node
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { parseDiff } from "../lib/diff.mjs";
import { createManifest, saveManifest } from "../lib/manifest.mjs";

const fail = (msg) => { console.error(`deltaview: ${msg}`); process.exit(1); };

function init(argv) {
  const { values: v } = parseArgs({ args: argv, options: {
    repo: { type: "string" }, ref: { type: "string" }, target: { type: "string" },
    base: { type: "string" }, head: { type: "string" }, out: { type: "string" }, pr: { type: "string" },
  } });
  for (const k of ["repo", "ref", "target", "base", "head", "out"]) if (!v[k]) fail(`init: missing --${k}`);
  const diff = execFileSync("git", ["-C", v.repo, "diff", "--no-color", "--find-renames", `${v.base}...${v.head}`],
    { encoding: "utf8", maxBuffer: 1 << 30 });
  let repo = null;
  try {
    repo = execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
      { cwd: v.repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { console.error("deltaview: warning: could not determine repo via gh; repo is null"); }
  const pr = v.pr ? JSON.parse(v.pr) : null;
  const newEnvVars = []; // Task 3
  saveManifest(v.out, createManifest({ ref: v.ref, target: v.target, baseSha: v.base, headSha: v.head,
    repo, pr, hunks: parseDiff(diff), newEnvVars }));
  console.log(v.out);
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = { init };
try {
  (commands[cmd] ?? (() => fail(`unknown subcommand ${cmd ?? ""}`)))(rest);
} catch (e) { fail(e.message); }
