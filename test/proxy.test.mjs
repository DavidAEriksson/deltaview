import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { injectScript, rewriteLocation, createServer } from "../skills/deltaview/scripts/lib/proxy.mjs";

const TAG = '<script type="module" src="/__deltaview/overlay.mjs"></script>';
const listen = (s) => new Promise((r) => s.listen(0, "127.0.0.1", () => r(s.address().port)));
const close = (s) => { s.closeAllConnections?.(); return new Promise((r) => s.close(r)); };
const req = (port, p, { method = "GET", body, headers = {} } = {}) => new Promise((res, rej) => {
  const r = http.request({ port, host: "127.0.0.1", path: p, method, headers: { connection: "close", ...(method === "POST" && { "content-type": "application/json" }), ...headers }, agent: false }, (m) => {
    const c = []; m.on("data", (d) => c.push(d)); m.on("end", () => res({ status: m.statusCode, headers: m.headers, buf: Buffer.concat(c), text: Buffer.concat(c).toString() }));
  });
  r.on("error", rej); r.end(body);
});

const baseManifest = (over = {}) => ({
  version: 1, ref: "r", target: "t", baseSha: "a", headSha: "b", repo: "o/n", pr: null, tests: null, newEnvVars: [],
  hunks: {}, status: "in_progress", reviewUrl: null, error: null, createdAt: "x",
  items: [{ id: "i1", tier: "direct", title: "T", route: null, selector: null, chain: [], affects: [], hunkIds: [],
    summary: "", howToReach: null, appearsUnused: false, visuallyVerified: true, decision: null, comment: "", decidedAt: null }],
  ...over,
});

// Starts a target + proxy; returns ports and a cleanup.
async function setup({ manifest = baseManifest(), postReview = async () => ({ url: "u" }), targetHandler } = {}) {
  const seen = {};
  const target = http.createServer(targetHandler ?? ((q, s) => {
    seen.acceptEncoding = q.headers["accept-encoding"];
    Object.assign(seen, { origin: q.headers.origin, referer: q.headers.referer });
    if (q.url === "/bin") { s.setHeader("content-type", "application/octet-stream"); return s.end(Buffer.from([0, 255, 1, 2])); }
    if (q.url === "/redir") { s.writeHead(302, { location: `http://127.0.0.1:${tport}/next` }); return s.end(); }
    s.writeHead(200, { "content-type": "text/html", "content-security-policy": "default-src 'self'", "content-length": "41" });
    s.end("<html><head></head><body>hi</body></html>");
  }));
  const sockets = [];
  target.on("upgrade", (q, sock) => {
    sockets.push(sock);
    seen.wsOrigin = q.headers.origin;
    sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    sock.on("data", (d) => sock.write(d));
  });
  const tport = await listen(target);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dv-"));
  const manifestPath = path.join(dir, "m.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const { server, finished } = createServer({ manifestPath, target: `http://127.0.0.1:${tport}`, postReview });
  const port = await listen(server);
  return { tport, port, seen, manifestPath, finished, read: () => JSON.parse(fs.readFileSync(manifestPath, "utf8")),
    cleanup: async () => { sockets.forEach((s) => s.destroy()); await close(server); await close(target); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const decide = (port, o) => req(port, "/__deltaview/decision", { method: "POST", body: JSON.stringify(o) });

test("injects before </head>", () => assert.equal(injectScript("<head></head>"), `<head>${TAG}</head>`));
test("falls back to </body>", () => assert.equal(injectScript("<body>x</body>"), `<body>x${TAG}</body>`));
test("appends when neither", () => assert.equal(injectScript("x"), "x" + TAG));
test("idempotent", () => { const o = injectScript("<head></head>"); assert.equal(injectScript(o), o); });
test("rewriteLocation maps target origin to proxy origin", () => {
  assert.equal(rewriteLocation("http://t:1/a", "http://t:1", "http://p:2"), "http://p:2/a");
  assert.equal(rewriteLocation("/a", "http://t:1", "http://p:2"), "/a");
});

test("proxied HTML has overlay script, no CSP, target sees no accept-encoding", async () => {
  const s = await setup();
  try {
    const r = await req(s.port, "/", { headers: { "accept-encoding": "gzip" } });
    assert.ok(r.text.includes(TAG));
    assert.equal(r.headers["content-security-policy"], undefined);
    assert.equal(s.seen.acceptEncoding, undefined);
  } finally { await s.cleanup(); }
});

test("non-HTML passes through byte-identical", async () => {
  const s = await setup();
  try { assert.deepEqual((await req(s.port, "/bin")).buf, Buffer.from([0, 255, 1, 2])); } finally { await s.cleanup(); }
});

test("redirect Location to target origin is rewritten to proxy origin", async () => {
  const s = await setup();
  try {
    const r = await req(s.port, "/redir");
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, `http://127.0.0.1:${s.port}/next`);
  } finally { await s.cleanup(); }
});

test("websocket upgrade is piped", async () => {
  const s = await setup();
  const sock = net.connect(s.port, "127.0.0.1");
  try {
    sock.write("GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    let got = "", sent = false;
    await new Promise((res, rej) => {
      sock.on("error", rej);
      sock.on("data", (d) => {
        got += d.toString("latin1");
        if (!sent && got.includes("\r\n\r\n")) { sent = true; sock.write("ping-bytes"); }
        if (got.endsWith("ping-bytes")) res();
      });
    });
    assert.match(got, /^HTTP\/1.1 101/);
  } finally { sock.destroy(); await s.cleanup(); }
});

test("POST decision persists to disk", async () => {
  const s = await setup();
  try {
    const r = await decide(s.port, { itemId: "i1", decision: "approved", comment: null });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.text).decision, "approved");
    assert.equal(s.read().items[0].decision, "approved");
  } finally { await s.cleanup(); }
});

test("POST decision rejected without reason -> 400; bad JSON -> 400", async () => {
  const s = await setup();
  try {
    const r = await decide(s.port, { itemId: "i1", decision: "rejected", comment: "" });
    assert.equal(r.status, 400);
    assert.ok(JSON.parse(r.text).error);
    const b = await req(s.port, "/__deltaview/decision", { method: "POST", body: "{nope" });
    assert.equal(b.status, 400);
  } finally { await s.cleanup(); }
});

test("POST finish success", async () => {
  const s = await setup({ manifest: baseManifest({ pr: { number: 1, url: "u", isAuthor: false } }), postReview: async () => ({ url: "https://gh/review" }) });
  try {
    const r = await req(s.port, "/__deltaview/finish", { method: "POST" });
    assert.deepEqual(JSON.parse(r.text), { reviewUrl: "https://gh/review" });
    assert.equal((await s.finished).reviewUrl, "https://gh/review");
    assert.equal(s.read().status, "finished");
    assert.equal(s.read().reviewUrl, "https://gh/review");
  } finally { await s.cleanup(); }
});

test("POST finish with gh failure -> 502, in_progress, error saved, still serving", async () => {
  const s = await setup({ manifest: baseManifest({ pr: { number: 1, url: "u", isAuthor: false } }), postReview: async () => { throw new Error("gh boom"); } });
  try {
    const r = await req(s.port, "/__deltaview/finish", { method: "POST" });
    assert.equal(r.status, 502);
    assert.match(JSON.parse(r.text).error, /gh boom/);
    assert.equal(s.read().status, "in_progress");
    assert.match(s.read().error, /gh boom/);
    assert.equal((await req(s.port, "/__deltaview/manifest")).status, 200);
  } finally { await s.cleanup(); }
});

test("POST finish with pr null finishes without calling postReview", async () => {
  let called = false;
  const s = await setup({ postReview: async () => { called = true; return { url: "x" }; } });
  try {
    const r = await req(s.port, "/__deltaview/finish", { method: "POST" });
    assert.equal(r.status, 200);
    assert.equal((await s.finished).reviewUrl, null);
    assert.equal(called, false);
    assert.equal(s.read().status, "finished");
  } finally { await s.cleanup(); }
});

test("unreachable target -> 502 with message", async () => {
  const dead = net.createServer(); const dp = await listen(dead); await close(dead);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dv-"));
  const manifestPath = path.join(dir, "m.json"); fs.writeFileSync(manifestPath, JSON.stringify(baseManifest()));
  const target = `http://127.0.0.1:${dp}`;
  const { server } = createServer({ manifestPath, target, postReview: async () => ({}) });
  const port = await listen(server);
  try {
    const r = await req(port, "/");
    assert.equal(r.status, 502);
    assert.equal(r.text, `Deltaview: dev server not reachable at ${target}`);
  } finally { await close(server); fs.rmSync(dir, { recursive: true, force: true }); }
});

const prManifest = () => baseManifest({ pr: { number: 1, url: "u", isAuthor: false } });
test("concurrent double finish posts once; later finish returns existing url", async () => {
  let calls = 0, release;
  const gate = new Promise((r) => { release = r; });
  const s = await setup({ manifest: prManifest(), postReview: async () => { calls++; await gate; return { url: "R" }; } });
  try {
    const a = req(s.port, "/__deltaview/finish", { method: "POST" });
    await new Promise((r) => setTimeout(r, 100));
    const b = await req(s.port, "/__deltaview/finish", { method: "POST" });
    assert.equal(b.status, 409);
    release();
    assert.equal((await a).status, 200);
    const c = await req(s.port, "/__deltaview/finish", { method: "POST" });
    assert.deepEqual([c.status, JSON.parse(c.text)], [200, { reviewUrl: "R" }]);
    assert.equal(calls, 1);
  } finally { await s.cleanup(); }
});

test("finish after a failure can retry", async () => {
  let calls = 0;
  const s = await setup({ manifest: prManifest(), postReview: async () => { if (++calls === 1) throw new Error("x"); return { url: "R" }; } });
  try {
    assert.equal((await req(s.port, "/__deltaview/finish", { method: "POST" })).status, 502);
    assert.equal((await req(s.port, "/__deltaview/finish", { method: "POST" })).status, 200);
    assert.equal(calls, 2);
  } finally { await s.cleanup(); }
});

test("decision during in-flight finish -> 409; failed finish keeps changes saved meanwhile", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = await setup({ manifest: prManifest(), postReview: async () => { await gate; throw new Error("gh boom"); } });
  try {
    assert.equal((await decide(s.port, { itemId: "i1", decision: "approved" })).status, 200);
    const f = req(s.port, "/__deltaview/finish", { method: "POST" });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await decide(s.port, { itemId: "i1", decision: "comment", comment: "c" })).status, 409);
    const m = s.read(); m.items[0].comment = "saved meanwhile"; fs.writeFileSync(s.manifestPath, JSON.stringify(m));
    release();
    assert.equal((await f).status, 502);
    assert.deepEqual([s.read().items[0].decision, s.read().items[0].comment, s.read().error], ["approved", "saved meanwhile", "gh boom"]);
  } finally { await s.cleanup(); }
});

test("CSRF: non-JSON POST -> 415, cross-site POST -> 403, same-origin ok", async () => {
  const s = await setup({ manifest: prManifest() });
  try {
    for (const p of ["decision", "finish"]) {
      assert.equal((await req(s.port, "/__deltaview/" + p, { method: "POST", body: "{}", headers: { "content-type": "text/plain" } })).status, 415);
      assert.equal((await req(s.port, "/__deltaview/" + p, { method: "POST", body: "{}", headers: { "sec-fetch-site": "cross-site" } })).status, 403);
    }
    assert.equal(s.read().status, "in_progress");
    assert.equal((await decide(s.port, { itemId: "i1", decision: "approved" })).status, 200);
    assert.equal((await req(s.port, "/__deltaview/decision", { method: "POST", body: JSON.stringify({ itemId: "i1", decision: "approved" }), headers: { "sec-fetch-site": "same-origin" } })).status, 200);
  } finally { await s.cleanup(); }
});

test("Origin/Referer mapped from proxy origin to target origin (HTTP and upgrade)", async () => {
  const s = await setup();
  const sock = net.connect(s.port, "127.0.0.1");
  try {
    const po = `http://127.0.0.1:${s.port}`, to = `http://127.0.0.1:${s.tport}`;
    await req(s.port, "/", { headers: { origin: po, referer: po + "/a?b" } });
    assert.deepEqual([s.seen.origin, s.seen.referer], [to, to + "/a?b"]);
    sock.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\nOrigin: ${po}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`);
    await new Promise((res, rej) => { sock.on("error", rej); sock.on("data", res); });
    assert.equal(s.seen.wsOrigin, to);
  } finally { sock.destroy(); await s.cleanup(); }
});

test("proxies an https dev server with a self-signed cert, including upgrades", async () => {
  const https = await import("node:https");
  const fx = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
  const target = https.createServer({ key: fx("tls-key.pem"), cert: fx("tls-cert.pem") }, (q, s) => {
    s.writeHead(200, { "content-type": "text/html" }); s.end("<html><head></head></html>");
  });
  target.on("upgrade", (q, sock) => { sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n"); sock.on("data", (d) => sock.write(d)); });
  const tport = await listen(target);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dv-"));
  const manifestPath = path.join(dir, "m.json");
  fs.writeFileSync(manifestPath, JSON.stringify(baseManifest()));
  const { server } = createServer({ manifestPath, target: `https://127.0.0.1:${tport}`, postReview: async () => ({}) });
  const port = await listen(server);
  try {
    assert.ok((await req(port, "/")).text.includes(TAG));
    const echoed = await new Promise((res, rej) => {
      const sock = net.connect(port, "127.0.0.1", () => sock.write("GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nping"));
      let buf = ""; sock.on("data", (d) => { buf += d; if (buf.endsWith("ping")) { sock.destroy(); res(buf); } }); sock.on("error", rej);
    });
    assert.match(echoed, /^HTTP\/1.1 101/);
  } finally { await close(server); target.closeAllConnections?.(); await new Promise((r) => target.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
});
