#!/usr/bin/env node
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { parseDiff } from "../lib/diff.mjs";
import fs from "node:fs";
import { createManifest, loadManifest, saveManifest, setItems } from "../lib/manifest.mjs";
import { newEnvVars } from "../lib/envcheck.mjs";
import { findResumable } from "../lib/resume.mjs";

const fail = (msg) => { console.error(`deltaview: ${msg}`); process.exit(1); };

const git = (repo, ...a) => execFileSync("git", ["-C", repo, "-c", "core.quotepath=false", ...a], { encoding: "utf8", maxBuffer: 1 << 30 });
const example = (repo, sha) => ["", ".sample", ".template"].map((x) => {
  try { return git(repo, "show", `${sha}:.env${x === "" ? ".example" : x}`); } catch { return ""; } // missing file counts as empty
}).join("\n");
const envVars = (repo, base, head, hunks) => {
  const ls = (t) => hunks.flatMap((h) => h.lines.filter((l) => l.type === t).map((l) => l.text));
  return newEnvVars({ baseExample: example(repo, base), headExample: example(repo, head), addedLines: ls("add"), removedLines: ls("del") });
};
const gitDiff = (repo, base, head) => git(repo, "diff", "--no-color", "--find-renames", `${base}...${head}`);

function init(argv) {
  const { values: v } = parseArgs({ args: argv, options: {
    repo: { type: "string" }, ref: { type: "string" }, target: { type: "string" },
    base: { type: "string" }, head: { type: "string" }, out: { type: "string" }, pr: { type: "string" },
  } });
  for (const k of ["repo", "ref", "target", "base", "head", "out"]) if (!v[k]) fail(`init: missing --${k}`);
  const hunks = parseDiff(gitDiff(v.repo, v.base, v.head));
  let repo = null;
  try {
    repo = execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
      { cwd: v.repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { console.error("deltaview: warning: could not determine repo via gh; repo is null"); }
  const pr = v.pr ? JSON.parse(v.pr) : null;
  saveManifest(v.out, createManifest({ ref: v.ref, target: v.target, baseSha: v.base, headSha: v.head,
    repo, pr, hunks, newEnvVars: envVars(v.repo, v.base, v.head, hunks) }));
  console.log(v.out);
}

function env(argv) {
  const { values: v } = parseArgs({ args: argv, options: { repo: { type: "string" }, base: { type: "string" }, head: { type: "string" } } });
  for (const k of ["repo", "base", "head"]) if (!v[k]) fail(`env: missing --${k}`);
  console.log(JSON.stringify(envVars(v.repo, v.base, v.head, parseDiff(gitDiff(v.repo, v.base, v.head)))));
}

function resume(argv) {
  const { values: v } = parseArgs({ args: argv, options: { dir: { type: "string" }, ref: { type: "string" }, head: { type: "string" } } });
  for (const k of ["dir", "ref", "head"]) if (!v[k]) fail(`resume: missing --${k}`);
  console.log(findResumable(v.dir, v.ref, v.head) ?? "");
}

function patch(argv) {
  const { values: v } = parseArgs({ args: argv, options: { manifest: { type: "string" }, json: { type: "string" } } });
  for (const k of ["manifest", "json"]) if (!v[k]) fail(`patch: missing --${k}`);
  const obj = JSON.parse(v.json);
  const bad = Object.keys(obj).filter((k) => !["tests", "pr", "newEnvVars"].includes(k));
  if (bad.length) fail(`patch: disallowed keys: ${bad.join(", ")}`);
  saveManifest(v.manifest, Object.assign(loadManifest(v.manifest), obj));
}

function addItems(argv) {
  const { values: v } = parseArgs({ args: argv, options: { manifest: { type: "string" }, items: { type: "string" } } });
  for (const k of ["manifest", "items"]) if (!v[k]) fail(`add-items: missing --${k}`);
  // setItems throws with the full newline-joined problem list; the top-level handler prints it
  saveManifest(v.manifest, setItems(loadManifest(v.manifest), JSON.parse(fs.readFileSync(v.items, "utf8"))));
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = { init, env, resume, patch, "add-items": addItems };
try {
  (commands[cmd] ?? (() => fail(`unknown subcommand ${cmd ?? ""}`)))(rest);
} catch (e) { fail(e.message); }
