import { toBlocks, progress, itemsForPath, canSubmit } from "./logic.mjs";

const CSS = `
:host{all:initial}
*{box-sizing:border-box;font:12px/1.45 ui-monospace,Menlo,Consolas,monospace}
.layer{position:fixed;inset:0;pointer-events:none;color:#cfd8e3}
.auto{pointer-events:auto}
.bar{z-index:2;position:fixed;bottom:12px;left:12px;max-width:min(440px,calc(100vw - 24px));display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:6px 10px;background:#111;border:1px solid #2c4155;border-radius:6px;pointer-events:auto}
.brand{color:#5ea1f0;font-weight:700;font-size:14px}
.muted{color:#8a96a3}.ok{color:#5fb584}.bad{color:#f08080}.warn{color:#d9822b}
.spacer{flex:1}
button{cursor:pointer;background:#162430;color:#5ea1f0;border:1px solid #2c4155;border-radius:4px;padding:4px 10px}
button:hover:not(:disabled){background:#1d3144}button:disabled{opacity:.4;cursor:not-allowed}
button.sel{background:#2c4155;color:#fff}button.go{background:#5ea1f0;color:#0b1520;font-weight:700}
.menu{position:absolute;bottom:100%;left:0;margin-bottom:6px;width:380px;max-width:calc(100vw - 24px);max-height:60vh;overflow:auto;background:#111;border:1px solid #2c4155;padding:6px;pointer-events:auto}
.menu h4{margin:8px 0 2px;color:#8a96a3;font-weight:400}
.row{display:flex;gap:8px;align-items:center;width:100%;text-align:left;border:0;background:none;color:#cfd8e3;padding:4px}
.row:hover{background:#162430}
.badge{color:#d9822b;border:1px solid #d9822b;border-radius:3px;padding:0 4px;font-size:10px}
.outline{position:fixed;border:2px solid #5ea1f0;background:rgba(94,161,240,.08);display:none}
.outline.open{border-color:#fff;background:rgba(94,161,240,.18)}
.outline.done{border-color:#5fb584}.outline.rej{border-color:#f08080}
.chip{position:absolute;left:-2px;bottom:100%;margin-bottom:2px;background:#111;color:#5ea1f0;border:1px solid #2c4155;padding:0 6px;pointer-events:auto;cursor:pointer;white-space:nowrap}
.panel{position:fixed;width:440px;max-height:calc(100vh - 16px);overflow:auto;background:#111;border:1px solid #2c4155;pointer-events:auto}
.drawer{position:fixed;top:0;right:0;bottom:0;width:480px;overflow:auto;background:#111;border-left:1px solid #2c4155;pointer-events:auto}
.card{padding:10px;border-bottom:1px solid #2c4155}
.card h3{margin:0 0 4px;color:#5ea1f0;font-size:13px}
.crumbs{color:#8a96a3;margin-bottom:6px}.crumbs b{color:#5ea1f0;font-weight:400}
.file{margin:8px 0 2px;color:#8a96a3}
.blk{padding:4px 8px;white-space:pre-wrap;word-break:break-all}
.blk.add{background:#2d4a2d;color:#5fb584}.blk.change{background:#503615;color:#d9822b}
.blk.del{background:#6e4343;color:#f08080}.blk.ctx{color:#5c6773}
.tag{display:inline-block;color:#d9822b;border:1px solid #d9822b;padding:0 5px;margin-bottom:4px}
.act{margin-top:8px;padding:8px;background:#162430;border:1px solid #2c4155}
.act textarea{width:100%;height:56px;margin:6px 0;background:#0b1520;color:#cfd8e3;border:1px solid #2c4155;padding:4px}
.msg{margin-top:4px}
`;

const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) e[k] = v;
  }
  e.append(...kids.flat().filter((x) => x != null && x !== false));
  return e;
};
const api = async (path, body) => {
  const r = await fetch("/__deltaview/" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

let barOpen = false, M, openId = null, drawer = false, menu = false, finishMsg = null, pendingScroll = null;
const drafts = {}; // itemId -> { choice, comment, msg }
const els = new Map(); // itemId -> resolved element
const outlines = new Map(); // itemId -> outline div

const host = document.createElement("deltaview-root");
host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
const root = host.attachShadow({ mode: "open" });
root.append(h("style", { textContent: CSS }));
const outlineLayer = h("div", { class: "layer" });
const uiLayer = h("div", { class: "layer" });
root.append(outlineLayer, uiLayer);

const byId = (id) => M.items.find((i) => i.id === id);
const onRoute = () => itemsForPath(M.items, location.pathname);
const here = (i) => itemsForPath([i], location.pathname).length > 0;
const resolve = (i) => { try { return i.selector ? document.querySelector(i.selector) : null; } catch { return null; } };

function resolveAll() {
  const cur = new Set(onRoute().map((i) => i.id));
  for (const id of [...els.keys()]) if (!cur.has(id)) els.delete(id);
  for (const i of onRoute()) {
    const el = resolve(i);
    el ? els.set(i.id, el) : els.delete(i.id);
  }
  if (pendingScroll && els.has(pendingScroll)) {
    els.get(pendingScroll).scrollIntoView({ block: "center" });
    pendingScroll = null;
  }
}

function openItem(i) {
  if (i.tier === "backstage" || (!i.route && !i.selector)) { drawer = true; openId = null; }
  else if (!here(i)) { location.href = i.route + "#dv=" + i.id; return; }
  else { openId = i.id; drawer = false; pendingScroll = i.id; resolveAll(); }
  menu = false;
  render();
}

function draft(i) { return (drafts[i.id] ??= { choice: i.decision, comment: i.comment ?? "", msg: "" }); }

function diffView(i) {
  return i.hunkIds.map((id) => {
    const hk = M.hunks[id];
    if (!hk) return null;
    return h("div", {}, h("div", { class: "file", textContent: hk.file + (hk.status !== "modified" ? ` (${hk.status})` : "") }),
      toBlocks(hk.lines).map((b) => h("div", { class: "blk " + b.kind, textContent: b.lines.map((l) => (l.type === "add" ? "+" : l.type === "del" ? "-" : " ") + l.text).join("\n") })));
  });
}

function card(i) {
  const d = draft(i);
  const submit = h("button", { class: "go", textContent: "Submit" });
  const msg = h("div", { class: "msg bad", textContent: d.msg });
  const ta = h("textarea", { placeholder: "Comment (required to reject)", value: d.comment });
  const btns = ["approved", "rejected", "comment"].map((c) => h("button", { class: d.choice === c ? "sel" : "", textContent: { approved: "Approve", rejected: "Reject", comment: "Comment" }[c], onclick: () => { d.choice = c; btns.forEach((b, n) => b.classList.toggle("sel", ["approved", "rejected", "comment"][n] === c)); sync(); } }));
  const sync = () => { submit.disabled = !d.choice || !canSubmit(d.choice, ta.value); };
  ta.addEventListener("input", () => { d.comment = ta.value; sync(); });
  submit.addEventListener("click", async () => {
    submit.disabled = true;
    const r = await api("decision", { itemId: i.id, decision: d.choice, comment: ta.value });
    if (r.status === 200) { M.items = M.items.map((x) => (x.id === i.id ? r.body : x)); d.msg = ""; render(); }
    else { d.msg = r.body.error ?? "Could not save decision"; msg.textContent = d.msg; sync(); }
  });
  sync();
  return h("div", { class: "card" },
    i.tier === "backstage" && h("div", { class: "tag", textContent: "Not visually verified" }),
    h("h3", { textContent: i.title }),
    i.chain.length > 0 && h("div", { class: "crumbs" }, i.chain.flatMap((c, n) => [n ? " › " : "", h("b", { textContent: c })])),
    i.howToReach && h("div", { class: "muted", textContent: "How to reach: " + i.howToReach }),
    i.appearsUnused && h("div", { class: "warn", textContent: "Warning: appears unused" }),
    diffView(i),
    h("p", { textContent: i.summary }),
    i.affects.length > 0 && h("div", { class: "muted", textContent: "Affects: " + i.affects.join(", ") }),
    h("div", { class: "act" },
      h("div", { class: i.decision ? "ok" : "muted", textContent: i.decision ? "Decision: " + i.decision : "No decision yet" }),
      h("div", {}, btns), ta, submit, msg));
}

function topbar() {
  const { done, total } = progress(M.items);
  const t = M.tests;
  const finish = h("button", { class: "go", textContent: "Finish", onclick: async (e) => {
    e.target.disabled = true;
    const r = await api("finish", {});
    e.target.disabled = false;
    finishMsg = r.status === 200 ? (r.body.reviewUrl ? { url: r.body.reviewUrl } : { text: "Review finished." })
      : r.status === 409 ? { text: "Finish already in progress.", warn: true } : { text: r.body.error ?? "Finish failed", bad: true };
    render();
  } });
  const full = barOpen;
  return h("div", { class: "bar" },
    menu && menuView(),
    h("span", { class: "brand", textContent: "DELTAVIEW/" + M.ref }),
    h("span", { textContent: `${done}/${total} reviewed` }),
    h("button", { textContent: full ? "▾" : "▴", title: full ? "Collapse" : "Expand", onclick: () => { barOpen = !barOpen; menu = false; render(); } }),
    full && t && h("span", { class: t.passed ? "ok" : "bad", textContent: `tests: ${t.passed ? "passed" : "failed"} (${t.summary})` }),
    full && M.newEnvVars.length > 0 && h("span", { class: "warn", textContent: "New env vars: " + M.newEnvVars.join(", ") }),
    finishMsg && (finishMsg.url ? h("a", { href: finishMsg.url, target: "_blank", style: "color:#5fb584", textContent: "Review posted: " + finishMsg.url })
      : h("span", { class: finishMsg.bad ? "bad" : finishMsg.warn ? "warn" : "ok", textContent: finishMsg.text })),
    full && h("button", { textContent: "Items ▾", onclick: () => { menu = !menu; render(); } }),
    full && h("button", { class: drawer ? "sel" : "", textContent: "Backstage", onclick: () => { drawer = !drawer; menu = false; render(); } }),
    full && finish);
}

function menuView() {
  const groups = new Map();
  for (const i of M.items) {
    const k = i.tier === "backstage" ? "Backstage" : i.route ?? "(no route)";
    (groups.get(k) ?? groups.set(k, []).get(k)).push(i);
  }
  return h("div", { class: "menu" }, [...groups].map(([k, list]) => h("div", {}, h("h4", { textContent: k }),
    list.map((i) => h("button", { class: "row", onclick: () => openItem(i) },
      h("span", { class: i.decision ? "ok" : "muted", textContent: i.decision ? "✓" : "○" }),
      h("span", { textContent: i.title }),
      here(i) && i.selector && !els.has(i.id) && h("span", { class: "badge", textContent: "not found on this page" }))))));
}

function panelView() {
  const i = openId && byId(openId);
  if (!i) return null;
  const p = h("div", { class: "panel" }, card(i));
  p.dataset.item = i.id;
  return p;
}

function render() {
  if (openId && !here(byId(openId))) openId = null;
  uiLayer.replaceChildren(...[topbar(), drawer && h("div", { class: "drawer" }, M.items.filter((i) => i.tier === "backstage").map(card)), panelView()].filter(Boolean));
  for (const i of onRoute()) {
    if (outlines.has(i.id)) continue;
    const chip = h("div", { class: "chip", onclick: () => openItem(i) });
    const o = h("div", { class: "outline" }, chip);
    outlines.set(i.id, o);
    outlineLayer.append(o);
  }
  const cur = new Set(onRoute().map((i) => i.id));
  for (const [id, o] of outlines) {
    if (!cur.has(id)) { o.remove(); outlines.delete(id); continue; }
    const i = byId(id);
    o.className = "outline" + (id === openId ? " open" : "") + (i.decision === "rejected" ? " rej" : i.decision ? " done" : "");
    o.firstChild.textContent = i.title + (i.decision ? " ✓" : "");
  }
}

function place() {
  for (const [id, o] of outlines) {
    const el = els.get(id), r = el?.isConnected && el.getBoundingClientRect();
    if (!r || (!r.width && !r.height)) { o.style.display = "none"; continue; }
    Object.assign(o.style, { display: "block", left: r.left - 3 + "px", top: r.top - 3 + "px", width: r.width + 6 + "px", height: r.height + 6 + "px" });
  }
  const p = uiLayer.querySelector(".panel"), r = p && els.get(p.dataset.item)?.getBoundingClientRect();
  if (p) {
    const w = p.offsetWidth || 440;
    const right = r ? r.right + 12 : innerWidth - w - 12;
    const left = r ? (right + w <= innerWidth - 8 ? right : Math.max(8, r.left - w - 12)) : right;
    p.style.left = left + "px";
    p.style.top = Math.max(8, Math.min(r ? r.top : 44, innerHeight - p.offsetHeight - 8)) + "px";
  }
  requestAnimationFrame(place);
}

async function start() {
  M = (await api("manifest")).body;
  const hash = /dv=([^&]+)/.exec(location.hash)?.[1];
  const target = hash && byId(decodeURIComponent(hash));
  document.documentElement.append(host);
  resolveAll();
  let t;
  new MutationObserver(() => { if (!t) t = setTimeout(() => { t = null; const sig = location.pathname + [...els.keys()].join(); resolveAll(); if (location.pathname + [...els.keys()].join() !== sig) render(); }, 200); })
    .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "id", "data-testid"] });
  if (target) openItem(target); else render();
  addEventListener("hashchange", () => { const i = byId(decodeURIComponent(/dv=([^&]+)/.exec(location.hash)?.[1] ?? "")); if (i) openItem(i); });
  for (const m of ["pushState", "replaceState"]) { const o = history[m]; history[m] = function (...a) { const x = o.apply(this, a); setTimeout(() => { resolveAll(); render(); }, 0); return x; }; }
  addEventListener("popstate", () => { resolveAll(); render(); });
  place();
}
start();
