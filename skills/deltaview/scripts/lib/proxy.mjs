import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import { loadManifest, saveManifest, applyDecision } from "./manifest.mjs";

const TAG = '<script type="module" src="/__deltaview/overlay.mjs"></script>';
const OVERLAY_DIR = new URL("../overlay/", import.meta.url);
const STRIP_HTML = ["content-length", "content-encoding", "content-security-policy", "content-security-policy-report-only"];

export function injectScript(html) {
  if (html.includes(TAG)) return html;
  for (const t of ["</head>", "</body>"]) {
    const i = html.indexOf(t);
    if (i >= 0) return html.slice(0, i) + TAG + html.slice(i);
  }
  return html + TAG;
}

export const rewriteLocation = (loc, targetOrigin, proxyOrigin) =>
  loc.startsWith(targetOrigin) ? proxyOrigin + loc.slice(targetOrigin.length) : loc;

const json = (res, status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok, no) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c).toString())); req.on("error", no); });

export function createServer({ manifestPath, target, postReview }) {
  const t = new URL(target);
  let resolveFinished, finishing = false;
  const finished = new Promise((r) => { resolveFinished = r; });

  async function api(req, res, name) {
    try {
      if (req.method === "GET" && (name === "overlay.mjs" || name === "logic.mjs")) {
        let src;
        try { src = fs.readFileSync(new URL(name, OVERLAY_DIR)); } catch { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "content-type": "text/javascript" });
        return res.end(src);
      }
      if (req.method === "GET" && name === "manifest") return json(res, 200, loadManifest(manifestPath));
      // CSRF: a cross-site form/fetch can't send application/json without a preflight we never answer
      if (req.method === "POST" && !/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return json(res, 415, { error: "content-type must be application/json" });
      if (req.method === "POST" && req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin") return json(res, 403, { error: "cross-site request" });
      if (req.method === "POST" && name === "decision") {
        if (finishing) return json(res, 409, { error: "finish in progress" });
        let item;
        try {
          const b = JSON.parse(await readBody(req));
          const m = loadManifest(manifestPath);
          applyDecision(m, { itemId: b.itemId, decision: b.decision, comment: b.comment ?? "" });
          saveManifest(manifestPath, m);
          item = m.items.find((i) => i.id === b.itemId);
        } catch (e) { return json(res, 400, { error: e.message }); }
        return json(res, 200, item);
      }
      if (req.method === "POST" && name === "finish") {
        const m = loadManifest(manifestPath);
        if (m.status === "finished") return json(res, 200, { reviewUrl: m.reviewUrl });
        if (finishing) return json(res, 409, { error: "finish already in progress" });
        finishing = true;
        let url = null;
        try {
          if (m.pr) {
            try { url = (await postReview(m)).url; } catch (e) {
              const fresh = loadManifest(manifestPath);
              fresh.error = String(e?.message ?? e); saveManifest(manifestPath, fresh);
              return json(res, 502, { error: fresh.error });
            }
          }
        } finally { finishing = false; }
        Object.assign(m, { status: "finished", reviewUrl: url, error: null });
        saveManifest(manifestPath, m);
        json(res, 200, { reviewUrl: url });
        return resolveFinished({ reviewUrl: url, manifestPath });
      }
      res.writeHead(404); res.end();
    } catch (e) { if (!res.headersSent) json(res, 500, { error: e.message }); else res.end(); }
  }

  // Host is rewritten to the target, so Origin/Referer must match it or app CSRF checks reject
  const upHeaders = (req) => {
    const h = { ...req.headers, host: t.host };
    for (const k of ["origin", "referer"]) if (h[k]) h[k] = rewriteLocation(h[k], `http://${req.headers.host}`, t.origin);
    return h;
  };

  const server = http.createServer((req, res) => {
    const m = /^\/__deltaview\/([^?]*)/.exec(req.url);
    if (m) return api(req, res, m[1]);
    const headers = upHeaders(req);
    delete headers["accept-encoding"];
    const up = http.request({ hostname: t.hostname, port: t.port || 80, path: req.url, method: req.method, headers, agent: false }, (r) => {
      const h = { ...r.headers };
      if (h.location) h.location = rewriteLocation(h.location, t.origin, `http://${req.headers.host}`);
      if (!/^text\/html/i.test(h["content-type"] ?? "")) { res.writeHead(r.statusCode, h); return r.pipe(res); }
      const c = []; r.on("data", (d) => c.push(d));
      r.on("end", () => {
        STRIP_HTML.forEach((k) => delete h[k]);
        res.writeHead(r.statusCode, h);
        res.end(injectScript(Buffer.concat(c).toString()));
      });
    });
    up.on("error", () => {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`Deltaview: dev server not reachable at ${target}`);
    });
    req.pipe(up);
  });

  server.on("upgrade", (req, sock, head) => {
    const up = net.connect(Number(t.port || 80), t.hostname, () => {
      const lines = Object.entries(upHeaders(req)).map(([k, v]) => `${k}: ${v}`);
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`);
      if (head.length) up.write(head);
      up.pipe(sock); sock.pipe(up);
    });
    up.on("error", () => sock.destroy());
    sock.on("error", () => up.destroy());
    sock.on("close", () => up.destroy());
    up.on("close", () => sock.destroy());
  });

  return { server, finished };
}
