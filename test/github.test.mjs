import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildReview, postReview } from "../skills/deltaview/scripts/lib/github.mjs";

const fx = () => JSON.parse(fs.readFileSync(new URL("./fixtures/manifest.json", import.meta.url), "utf8"));
const byPath = (r, p) => r.comments.find((c) => c.path === p);

test("event REQUEST_CHANGES when any rejected", () => {
  assert.equal(buildReview(fx()).event, "REQUEST_CHANGES");
});

test("event APPROVE when all approved", () => {
  const m = fx();
  m.items.forEach((i) => Object.assign(i, { decision: "approved", comment: "" }));
  assert.equal(buildReview(m).event, "APPROVE");
});

test("event COMMENT when mixed without rejections", () => {
  const m = fx();
  m.items[1].decision = "approved";
  assert.equal(buildReview(m).event, "COMMENT");
});

test("event COMMENT when pr.isAuthor even with rejection, body explains", () => {
  const m = fx();
  m.pr.isAuthor = true;
  const r = buildReview(m);
  assert.equal(r.event, "COMMENT");
  assert.match(r.body, /Posted as COMMENT because GitHub doesn't allow approving or requesting changes on your own PR\./);
});

test("add hunk → RIGHT side, start_line..line span", () => {
  const r = buildReview(fx());
  assert.deepEqual(byPath(r, "src/a.tsx"), {
    path: "src/a.tsx", body: "✅ approved via Deltaview",
    line: 12, side: "RIGHT", start_line: 10, start_side: "RIGHT",
  });
  const single = byPath(r, "src/b.tsx");
  assert.equal(single.line, 4);
  assert.equal(single.start_line, undefined);
  assert.equal(single.body, "❌ Rejected: Total wrong");
});

test("deletion-only hunk → LEFT side using oldLine", () => {
  const c = byPath(buildReview(fx()), "src/old.ts");
  assert.equal(c.side, "LEFT");
  assert.equal(c.line, 3);
  assert.equal(c.start_line, 1);
  assert.equal(c.start_side, "LEFT");
});

test("backstage comment carries \"Not visually verified\"", () => {
  const c = byPath(buildReview(fx()), "src/api.ts");
  assert.equal(c.body, "💬 Check the index\n\n_Not visually verified._\n\nAlso covers: logo.png");
});

test("binary-only item absent from comments, present in body", () => {
  const m = fx();
  m.items.push({ ...m.items[3], id: "i6", title: "Logo", hunkIds: ["h4"], decision: "approved" });
  m.items[2].hunkIds = ["h3"];
  const r = buildReview(m);
  assert.ok(!r.comments.some((c) => c.path === "logo.png"));
  assert.match(r.body, /Logo/);
});

test("item with no add/del lines (pure rename) is treated like binary-only", () => {
  const m = fx();
  m.hunks.h7 = { id: "h7", file: "n.ts", oldFile: "o.ts", status: "renamed", oldStart: 0, newStart: 0, lines: [] };
  m.items.push({ ...m.items[3], id: "i7", title: "Renamed file", hunkIds: ["h7"], decision: "approved" });
  const r = buildReview(m);
  assert.ok(!r.comments.some((c) => c.path === "n.ts" || c.path === "o.ts"));
  assert.match(r.body, /Renamed file/);
});

test("undecided item listed under Not reviewed, no comment", () => {
  const r = buildReview(fx());
  assert.ok(!r.comments.some((c) => c.path === "src/c.tsx"));
  assert.match(r.body, /Not reviewed[\s\S]*Pay button/);
  assert.match(r.body, /2 approved/);
  assert.match(r.body, /42 passed/);
  assert.match(r.body, /STRIPE_WEBHOOK_SECRET/);
});

test("postReview passes JSON with commit_id to fake run and returns html_url", async () => {
  const m = fx();
  let call;
  const run = async (cmd, args, input) => {
    call = { cmd, args, input };
    return { stdout: JSON.stringify({ html_url: "https://github.com/acme/shop/pull/7#pullrequestreview-1" }) };
  };
  const out = await postReview(m, run);
  assert.equal(out.url, "https://github.com/acme/shop/pull/7#pullrequestreview-1");
  assert.equal(call.cmd, "gh");
  assert.deepEqual(call.args, ["api", "repos/acme/shop/pulls/7/reviews", "--method", "POST", "--input", "-"]);
  const body = JSON.parse(call.input);
  assert.equal(body.commit_id, "bbb");
  assert.equal(body.event, "REQUEST_CHANGES");
});

test("postReview rejects with stderr when run fails", async () => {
  const run = async () => { throw new Error("HTTP 422: bad line"); };
  await assert.rejects(postReview(fx(), run), /HTTP 422: bad line/);
});

test("defaultRun: child exits before reading stdin -> rejects with stderr, no EPIPE crash", async () => {
  const { defaultRun } = await import("../skills/deltaview/scripts/lib/github.mjs");
  await assert.rejects(defaultRun("sh", ["-c", "echo err >&2; exit 1"], "x".repeat(4 * 1024 * 1024)), /^Error: err$/);
});
