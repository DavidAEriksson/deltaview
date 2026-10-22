# Deltaview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin whose `/deltaview <branch|commit>` skill shows a branch's changes as review overlays on the running app in the reviewer's Chrome, and posts the decisions as a GitHub review plus a manifest.

**Architecture:** The plugin has two halves. `SKILL.md` holds the agent's procedure: resolve, checkout, tests, analysis, anchoring. A zero-dependency Node toolkit does everything deterministic: diff parsing, the manifest, env-var detection, resume lookup, a proxy that injects the overlay, the decision API, and GitHub posting. The agent calls the toolkit through one CLI, `scripts/bin/deltaview.mjs`. The overlay is a plain ES module injected by the proxy and rendered inside a Shadow DOM.

**Tech Stack:** Node ≥ 20 (ESM, `node:http`, `node:net`, `node:test`), no npm dependencies, `git`, the `gh` CLI, and the Claude in Chrome MCP tools.

**Spec:** `docs/superpowers/specs/2026-10-22-deltaview-design.md` (mockups in `docs/superpowers/specs/assets/`)

## Global Constraints

- No npm dependencies, at runtime or for tests. Use Node built-ins only.
- Never modify the target app's source or the reviewer's working copy. The only write to the main checkout is under `.deltaview/`, plus one line `.deltaview/` appended to `.git/info/exclude`.
- Never generate, edit, log or print secret values. `.env*` files are copied byte-for-byte and never read into output.
- The agent never clicks in the app. It may only navigate by URL, scroll and read. It must not use `javascript_tool` to dispatch events or call `.click()`.
- Every hunk in the diff belongs to exactly one item. Validation enforces this.
- Backstage items always have `visuallyVerified: false`, and are tagged "not visually verified" in the UI, on GitHub and in the manifest.
- Rejecting an item requires a non-empty reason.
- The overlay label text is `DELTAVIEW/<ref>`.
- The approval note on GitHub is exactly `✅ approved via Deltaview`.
- The review event is `REQUEST_CHANGES` if any item is rejected, else `APPROVE` if every item is approved, else `COMMENT`. It is always `COMMENT` when the reviewer is the PR author.
- Manifest path: `<main checkout>/.deltaview/reviews/<slug(ref)>-<timestamp>.json`, plus a sibling `.md` file.

## Review Focus

1. **HTML that's compressed, chunked, or has no `</head>`.** The overlay must still be injected. The proxy asks for `accept-encoding: identity` and falls back to `</body>`, then to appending at the end. Covered in Task 5.
2. **A selector that no longer matches** (after a hot reload or re-render). The item must still be listed and decidable in the top bar, marked "not found on this page", never silently gone. Covered in Task 6.
3. **Items that only delete lines, or touch a binary file.** The GitHub comment must use `side: "LEFT"` for deletions. Binary files can't take inline comments, so they move into the review body. Covered in Task 4.
4. **`gh` failing on Finish** (network down, auth expired). The review must stay `in_progress`, the UI shows the error, the server keeps running so Finish can be retried, and no decision is lost. Covered in Task 5.
5. **The reviewer is the PR author.** The event is forced to `COMMENT`, and the review body says why. Covered in Task 4.

---

## File Structure

```
.claude-plugin/marketplace.json        marketplace entry (source "./")
.claude-plugin/plugin.json             plugin metadata
package.json                           "type":"module", "test":"node --test test/", engines node>=20
README.md                              install + usage
skills/deltaview/SKILL.md              agent procedure for /deltaview
skills/deltaview/scripts/bin/deltaview.mjs   CLI: init | patch | add-items | env | resume | serve
skills/deltaview/scripts/lib/manifest.mjs    create/load/save/setItems/applyDecision
skills/deltaview/scripts/lib/diff.mjs        parseDiff
skills/deltaview/scripts/lib/envcheck.mjs    newEnvVars
skills/deltaview/scripts/lib/resume.mjs      slug, findResumable
skills/deltaview/scripts/lib/github.mjs      buildReview, postReview
skills/deltaview/scripts/lib/markdown.mjs    renderMarkdown
skills/deltaview/scripts/lib/proxy.mjs       injectScript, rewriteLocation, createServer
skills/deltaview/scripts/overlay/logic.mjs   pure overlay logic (tested in node)
skills/deltaview/scripts/overlay/overlay.mjs DOM/Shadow-DOM UI (served to the browser)
test/*.test.mjs                        node:test suites
test/fixtures/                         sample diffs, sample manifest, tiny static site
```

Scripts live under the skill folder so that `SKILL.md` can call them through its own base directory, without relying on plugin environment variables.

## Shared Types (used by every task)

```js
// Hunk — produced by parseDiff (Task 2)
{ id: "h1", file: "src/a.tsx", oldFile: "src/a.tsx",
  status: "added"|"deleted"|"modified"|"renamed"|"binary",
  oldStart: 10, newStart: 12,
  lines: [{ type: "add"|"del"|"ctx", text: "…", oldLine: 10|null, newLine: 12|null }] }

// Item — written by the agent, validated by setItems (Task 1)
{ id: "i1", tier: "direct"|"indirect"|"backstage", title: "Save button",
  route: "/orders/new"|null, selector: "[data-testid=save]"|null,
  chain: ["Save button","useSaveOrder()","POST /api/orders","orders.handler.ts"],
  affects: ["Checkout › Pay button"], hunkIds: ["h3","h7"],
  summary: "…plain-language breakdown…", howToReach: "…"|null,
  appearsUnused: false, visuallyVerified: true,
  decision: null|"approved"|"rejected"|"comment", comment: "", decidedAt: null|ISO }

// Manifest
{ version: 1, ref, target, baseSha, headSha, repo: "owner/name",
  pr: null|{ number, url, isAuthor }, tests: null|{ command, passed, summary },
  newEnvVars: ["STRIPE_WEBHOOK_SECRET"], hunks: { h1: Hunk, … }, items: [Item],
  status: "in_progress"|"finished", reviewUrl: null|string, error: null|string,
  createdAt: ISO }
```

---

### Task 1: Scaffold + manifest module

**Files:**
- Create: `package.json`, `skills/deltaview/scripts/lib/manifest.mjs`, `skills/deltaview/scripts/lib/markdown.mjs` (stub: `renderMarkdown(m) => "# Deltaview review\n"`, completed in Task 4)
- Test: `test/manifest.test.mjs`

**Interfaces:**
- Produces:
  - `createManifest({ref, target, baseSha, headSha, repo, pr, hunks, newEnvVars}) -> Manifest`. `hunks` is a `Hunk[]` and gets stored keyed by id. Sets `status: "in_progress"`, `items: []`, `tests: null`.
  - `loadManifest(path) -> Manifest`
  - `saveManifest(path, manifest) -> void`. Writes `path + ".tmp"`, then renames it into place. Also writes `path` with `.json` replaced by `.md`, using `renderMarkdown`. Creates parent directories.
  - `setItems(manifest, items) -> Manifest`. Throws an `Error` whose message lists *all* problems, one per line.
  - `applyDecision(manifest, {itemId, decision, comment}) -> Manifest`. Sets `decidedAt`.

- [ ] **Step 1: Write the failing tests** in `test/manifest.test.mjs`. Build a two-hunk manifest (`h1`, `h2`) for each test.
  - `setItems rejects uncovered hunk`: items cover only `h1`, so it throws a message containing `h2 not covered`.
  - `setItems rejects double-covered hunk`: two items both list `h1`, so it throws a message containing `h1 covered by i1, i2`.
  - `setItems rejects unknown hunk id`: `hunkIds: ["h9"]` throws a message containing `unknown hunk h9`.
  - `setItems requires route+selector for direct/indirect`: it throws a message containing `i1 missing selector`.
  - `setItems forces backstage visuallyVerified=false and direct/indirect true`: the input says the opposite, and the stored values are corrected.
  - `setItems requires non-empty summary`.
  - `applyDecision rejected without reason throws` (`comment: "  "`).
  - `applyDecision on finished manifest throws`.
  - `applyDecision unknown item throws`.
  - `saveManifest then loadManifest round-trips and writes .md sibling`, written to a `fs.mkdtemp` dir. Afterwards no `.tmp` file remains.

- [ ] **Step 2: Run** `node --test test/manifest.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `manifest.mjs`, `package.json` (`{"name":"deltaview","type":"module","private":true,"engines":{"node":">=20"},"scripts":{"test":"node --test test/"}}`) and the markdown stub.
- [ ] **Step 4: Run** `node --test test/manifest.test.mjs`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: manifest model with coverage validation`

### Task 2: Diff parser + `init` CLI

**Files:**
- Create: `skills/deltaview/scripts/lib/diff.mjs`, `skills/deltaview/scripts/bin/deltaview.mjs`
- Test: `test/diff.test.mjs`, `test/fixtures/sample.diff` (hand-written: one modified file with 2 hunks, one added file, one deleted file, one rename with edits, one `Binary files … differ`)

**Interfaces:**
- Consumes: `createManifest`, `saveManifest` (Task 1)
- Produces:
  - `parseDiff(text) -> Hunk[]`. Ids are `h1…hN` in order. Each binary file gets a single hunk with `lines: []` and `status: "binary"`. A deleted file has `file === oldFile` and `status: "deleted"`.
  - The CLI `deltaview.mjs init --repo <dir> --ref <ref> --target <branch> --base <sha> --head <sha> --out <path> [--pr '<json>']`. It runs `git -C <repo> diff --no-color --find-renames <base>...<head>`, computes `newEnvVars` (Task 3; until then `[]`), reads `repo` from `gh repo view --json nameWithOwner -q .nameWithOwner`, saves the manifest and prints the path.
  - CLI pattern: `deltaview.mjs <subcommand> --flag value`. Flags are parsed with `node:util` `parseArgs`. Errors go to stderr with exit code 1. JSON output goes to stdout.

- [ ] **Step 1: Write failing tests:**
  - `parses modified file into 2 hunks with correct line numbers`: assert the first `add` line's `newLine`, the first `del` line's `oldLine`, and that `ctx` lines carry both numbers.
  - `added file: all lines add, status added`
  - `deleted file: status deleted, all del with oldLine`
  - `rename: file is new path, oldFile is old path, status renamed`
  - `binary: one hunk, status binary, lines empty`
  - `ignores "\ No newline at end of file"`
- [ ] **Step 2: Run** `node --test test/diff.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `parseDiff`, plus the CLI skeleton with `init`.
- [ ] **Step 4: Run** `node --test test/`. Expected: pass. Then smoke-test it: in a temp git repo with two commits, run `node skills/deltaview/scripts/bin/deltaview.mjs init --repo <tmp> --ref t --target main --base HEAD~1 --head HEAD --out <tmp>/m.json`. The manifest should exist and list the hunks. (`gh repo view` fails in a repo with no remote; in that case `repo` is `null` and a warning goes to stderr.)
- [ ] **Step 5: Commit** `feat: diff parser and init CLI`

### Task 3: Env-var check, resume lookup, remaining CLI subcommands

**Files:**
- Create: `skills/deltaview/scripts/lib/envcheck.mjs`, `skills/deltaview/scripts/lib/resume.mjs`
- Modify: `skills/deltaview/scripts/bin/deltaview.mjs` (add `env`, `resume`, `patch`, `add-items`, and wire `env` into `init`)
- Test: `test/envcheck.test.mjs`, `test/resume.test.mjs`

**Interfaces:**
- Consumes: `parseDiff`, `loadManifest`, `saveManifest`, `setItems`
- Produces:
  - `newEnvVars({baseExample, headExample, addedLines, removedLines}) -> string[]` (sorted, unique). It returns the keys in `headExample` that aren't in `baseExample`, plus the names matched by `process.env.X`, `process.env["X"]` or `import.meta.env.X` in `addedLines` that aren't in `baseExample` and don't appear in `removedLines`. Add the comment `// shortcut: an existing var newly referenced but absent from .env.example is reported as new; upgrade by scanning the base tree if false positives annoy reviewers`.
  - CLI `env --repo --base --head`. It reads `.env.example`, `.env.sample` and `.env.template` at each sha with `git show <sha>:<file>` (a missing file counts as empty) and prints a JSON array.
  - `slug(ref) -> string`. Replaces each run of `/` or any char outside `[A-Za-z0-9._-]` with `-`.
  - `findResumable(reviewsDir, ref, headSha) -> string|null`. It returns the newest `<slug(ref)>-*.json` with `status === "in_progress"` and a matching `headSha`. A missing dir gives `null`.
  - CLI `resume --dir --ref --head` prints the path, or an empty string.
  - CLI `patch --manifest <p> --json '<obj>'` shallow-merges the allowed keys `tests`, `pr` and `newEnvVars`. Other keys cause exit 1.
  - CLI `add-items --manifest <p> --items <file.json>` calls `setItems`. On error it prints the full problem list and exits 1, so the agent can fix the items and retry.

- [ ] **Step 1: Write failing tests:**
  - `new key in .env.example is reported`
  - `existing key not reported`
  - `process.env.FOO and import.meta.env.VITE_BAR in added lines reported`
  - `var present in removed lines (rename of usage) not reported`
  - `slug("feat/some-changes") === "feat-some-changes"`
  - `findResumable picks newest in_progress with matching headSha`. Three files: one finished, one older in_progress and one newer in_progress with a matching sha. Expect the newer one.
  - `findResumable returns null when headSha differs`
  - `findResumable returns null for missing dir`
- [ ] **Step 2: Run** `node --test test/envcheck.test.mjs test/resume.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the libs and the CLI subcommands.
- [ ] **Step 4: Run** `node --test test/`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: env-var detection, resume lookup, manifest CLI`

### Task 4: GitHub review builder/poster + Markdown

**Files:**
- Create: `skills/deltaview/scripts/lib/github.mjs`
- Modify: `skills/deltaview/scripts/lib/markdown.mjs` (full rendering)
- Test: `test/github.test.mjs`, `test/markdown.test.mjs`, `test/fixtures/manifest.json` (5 items: approved direct, rejected indirect, comment backstage, undecided direct, an approved item whose only hunk is deletion-only, plus a binary-file hunk on the backstage item)

**Interfaces:**
- Consumes: Manifest/Hunk/Item types
- Produces:
  - `buildReview(manifest) -> { event, body, comments: [{path, body, line, side, start_line?, start_side?}] }`
  - `postReview(manifest, run = defaultRun) -> Promise<{ url }>`. It calls `run("gh", ["api", `repos/${repo}/pulls/${pr.number}/reviews`, "--method", "POST", "--input", "-"], JSON.stringify({commit_id: headSha, ...buildReview(m)}))`, parses `html_url` from stdout, and rejects with gh's stderr on a non-zero exit. `defaultRun(cmd, args, input) -> Promise<{stdout}>` wraps `child_process.execFile`.
  - `renderMarkdown(manifest) -> string`

**Comment anchoring rules (one comment per decided item, on its first non-binary hunk):**
- If the hunk has `add` lines: `side: "RIGHT"`, `line` = the last add `newLine`, and `start_line` = the first add `newLine` when it differs (with `start_side: "RIGHT"`).
- Otherwise (deletion-only): `side: "LEFT"`, the same rule applied to the `del` lines' `oldLine`.
- `path` = `hunk.file`, or `hunk.oldFile` for deleted files.
- The comment body by decision: approved gives `✅ approved via Deltaview`, rejected gives `❌ Rejected: <comment>`, comment gives `💬 <comment>`. Backstage items get the suffix `\n\n_Not visually verified._`. When an item spans several files, append `\n\nAlso covers: <other files>`.
- When every hunk of an item is binary, the item goes in the body only.
- Undecided items get no inline comment and are listed in the body under "Not reviewed".

**Body:** `## Deltaview review`, then the counts (approved/rejected/comment/not reviewed of the total), the test result line, new env vars (if any), the list of rejections with reasons, and the binary-only items. If `pr.isAuthor`, add the line `Posted as COMMENT because GitHub doesn't allow approving or requesting changes on your own PR.`

- [ ] **Step 1: Write failing tests:**
  - `event REQUEST_CHANGES when any rejected`
  - `event APPROVE when all approved`
  - `event COMMENT when mixed without rejections`
  - `event COMMENT when pr.isAuthor even with rejection, body explains`
  - `add hunk → RIGHT side, start_line..line span`
  - `deletion-only hunk → LEFT side using oldLine`
  - `backstage comment carries "Not visually verified"`
  - `binary-only item absent from comments, present in body`
  - `undecided item listed under Not reviewed, no comment`
  - `postReview passes JSON with commit_id to fake run and returns html_url`
  - `postReview rejects with stderr when run fails`
  - `renderMarkdown lists every item with tier, decision, comment, files`
- [ ] **Step 2: Run** `node --test test/github.test.mjs test/markdown.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test test/`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: GitHub review mapping and markdown rendering`

### Task 5: Proxy + decision API + `serve`

**Files:**
- Create: `skills/deltaview/scripts/lib/proxy.mjs`
- Modify: `skills/deltaview/scripts/bin/deltaview.mjs` (add `serve`)
- Test: `test/proxy.test.mjs` (spins up a real target `http.Server` on port 0)

**Interfaces:**
- Consumes: `loadManifest`, `saveManifest`, `applyDecision`, `postReview`
- Produces:
  - `injectScript(html) -> string`. Inserts `<script type="module" src="/__deltaview/overlay.mjs"></script>` before `</head>`, else before `</body>`, else appends it. It is idempotent: if the tag is already present, the HTML is returned unchanged.
  - `rewriteLocation(location, targetOrigin, proxyOrigin) -> string`
  - `createServer({ manifestPath, target, postReview }) -> { server: http.Server, finished: Promise<{reviewUrl, manifestPath}> }`
  - Routes, all under `/__deltaview/`:
    - `GET overlay.mjs` and `GET logic.mjs` serve files from `scripts/overlay/` as `text/javascript`.
    - `GET manifest` serves the current manifest JSON.
    - `POST decision` takes the body `{itemId, decision, comment}`, calls `applyDecision` then `saveManifest`, and returns the updated item. It returns 400 with `{error}` on validation errors.
    - `POST finish` posts the review only when `pr` is set. On success it sets `status: "finished"`, sets `reviewUrl`, saves, responds `{reviewUrl}` and resolves `finished`. On failure it sets `error`, saves with status still `in_progress`, and returns 502 `{error}`. The server keeps running.
  - Everything else is proxied to `target`. Strip the request's `accept-encoding`. For `text/html` responses, buffer the body, drop `content-length`, `content-encoding`, `content-security-policy` and `content-security-policy-report-only`, then call `injectScript`. Rewrite `location` headers. Handle `upgrade` events by opening `net.connect` to the target, replaying the request line and headers, and piping both directions. A target that can't be reached returns 502 with the plain text `Deltaview: dev server not reachable at <target>`.
  - CLI `serve --manifest <p> --target <url> --port <n>`. It listens and prints `{"proxyUrl": "...", "port": n}` on its first stdout line. When `finished` resolves it prints `{"done": true, "reviewUrl": ..., "manifestPath": ...}` and exits 0. Exit 1 with a message if the port is in use.

- [ ] **Step 1: Write failing tests:**
  - `injects before </head>`, `falls back to </body>`, `appends when neither`, `idempotent`
  - `proxied HTML response contains overlay script and no CSP header`. The target sends gzip if asked, so also assert the proxy stripped `accept-encoding`: the target sees none.
  - `non-HTML passes through byte-identical`
  - `redirect Location to target origin is rewritten to proxy origin`
  - `websocket upgrade is piped`. The target handles `upgrade` by writing a `101` response and echoing raw bytes. Assert the echo arrives through the proxy.
  - `POST decision persists to disk`. Read the file back after the request.
  - `POST decision rejected without reason → 400`
  - `POST finish success → finished resolves, manifest status finished, reviewUrl set` (with a fake `postReview`)
  - `POST finish with gh failure → 502, status still in_progress, error saved, server still serving` (with a fake `postReview` that rejects)
  - `POST finish with pr null → finished without calling postReview`
  - `unreachable target → 502 with message`
- [ ] **Step 2: Run** `node --test test/proxy.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test test/`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: injecting proxy, decision API, serve CLI`

### Task 6: Overlay UI

**Files:**
- Create: `skills/deltaview/scripts/overlay/logic.mjs`, `skills/deltaview/scripts/overlay/overlay.mjs`, `test/fixtures/site/index.html` + `test/fixtures/site/orders.html` (static pages with `data-testid` elements), `test/fixtures/site-manifest.json` (direct, indirect and backstage items, plus one item whose selector matches nothing)
- Test: `test/overlay-logic.test.mjs`

**Interfaces:**
- Consumes: the `/__deltaview/` routes (Task 5), the Manifest types
- Produces (`logic.mjs`, pure, no DOM):
  - `toBlocks(lines) -> [{ kind: "ctx"|"add"|"del"|"change", lines }]`. A run of `del` lines directly followed by `add` lines becomes one `change` block holding both, rendered orange.
  - `progress(items) -> { done, total }`, where done means `decision !== null`.
  - `itemsForPath(items, pathname) -> Item[]`, matching on `item.route === pathname`, with trailing slashes normalized.
  - `canSubmit(decision, comment) -> boolean`. False when the decision is rejected or comment and the trimmed comment is empty.

**UI (`overlay.mjs`):** it's an ES module that imports `./logic.mjs`. Everything renders inside one Shadow DOM host (`<deltaview-root>`) that sits at a high z-index with `pointer-events: none`, except on its own controls. The dark styling follows the mockups. It contains:
- **Top bar:** `DELTAVIEW/<ref>`, `done/total reviewed`, the test result, the new env vars banner, a dropdown listing all items grouped by route, the Backstage button and the Finish button. Choosing an item from another route sets `location.href = route + "#dv=" + id`. On load, a `#dv=` hash opens that item and scrolls to it.
- **Per item on the current route:** an outline box tracking `getBoundingClientRect()`, updated on scroll, resize and `requestAnimationFrame` while visible. The selector is re-resolved through a `MutationObserver` (throttled). If the selector doesn't resolve, the item gets a "not found on this page" badge in the top bar list and can still be opened there.
- **Opened item panel:** placed beside the element (to the right, flipping left when there isn't room). It shows the `chain` breadcrumb, `toBlocks` diff blocks per hunk with file headers (green, orange, red, then context dimmed), the `summary`, `affects`, and an "appears unused" warning when set. Below it sit Approve, Reject and Comment, with a textarea. Submit is disabled unless `canSubmit` allows it.
- **Backstage drawer:** the same panel content for backstage items, each tagged "Not visually verified" and showing `howToReach` when present.
- **Finish:** POST to `finish`. On 502, show the error and keep everything. On success, show the review link.
- Decisions POST immediately. The UI updates from the item the server returns.

- [ ] **Step 1: Write failing tests** for `logic.mjs`:
  - `del run followed by add run → single change block`
  - `lone add → add block; lone del → del block; ctx separates blocks`
  - `progress counts decided items`
  - `itemsForPath normalizes trailing slash`
  - `canSubmit: approved with empty comment true; rejected with "  " false; comment with text true`
- [ ] **Step 2: Run** `node --test test/overlay-logic.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `logic.mjs`, then run the tests. Expected: pass.
- [ ] **Step 4: Implement** `overlay.mjs`.
- [ ] **Step 5: Manual check.** Serve the fixture site with `python3 -m http.server 4600 -d test/fixtures/site` (in the background), copy `site-manifest.json` to a temp path, then run `node skills/deltaview/scripts/bin/deltaview.mjs serve --manifest <tmp> --target http://localhost:4600 --port 4601`. Open `http://localhost:4601/` in Chrome (Claude in Chrome) and verify:
  - the outlines sit on the right elements;
  - an opened panel shows colored blocks;
  - reject is blocked without a reason;
  - a decision shows up in the temp manifest file;
  - the missing-selector item shows "not found on this page";
  - Backstage lists its item with the tag;
  - navigating between items across pages works;
  - Finish with `pr: null` ends the server.

  Capture a screenshot for the user.
- [ ] **Step 6: Commit** `feat: overlay UI`

### Task 7: Skill procedure + plugin packaging + end-to-end run

**Files:**
- Create: `skills/deltaview/SKILL.md`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `README.md`

**Interfaces:**
- Consumes: every CLI subcommand (Tasks 2 to 5), referenced in SKILL.md as `node <skill base dir>/scripts/bin/deltaview.mjs …`
- Produces: `/deltaview <branch|commit>`
  - `plugin.json`: `{"name":"deltaview","version":"0.1.0","description":"Visual, in-browser review of a branch's changes with overlays on the running app","author":{"name":"David Eriksson"},"repository":"https://github.com/DavidAEriksson/deltaview"}`
  - `marketplace.json`: `{"name":"deltaview","owner":{"name":"David Eriksson"},"plugins":[{"name":"deltaview","source":"./","description":"<same as above>"}]}`

**SKILL.md content.** Frontmatter: `name: deltaview`, a `description` that triggers on `/deltaview <branch|commit>` and "visually review a branch/PR", and `argument-hint: <branch|commit>`. The body is numbered steps that follow the spec's flow, with these decisions baked in:
1. **Preflight.**
   - Run `gh auth status`. If it fails, warn that nothing can be posted, but continue.
   - Load the Claude in Chrome tools in one ToolSearch call. If they're unavailable, stop and tell the user the extension is required.
   - The current repo is the main checkout.
2. **Resolve.**
   - If `<arg>` isn't a local ref, `git fetch origin <arg>`.
   - Run `gh pr list --head <branch> --state open --json number,url,baseRefName,author,headRepositoryOwner`. If this is a fork PR, use `gh pr checkout`-style fetching (`git fetch origin pull/<n>/head`).
   - `isAuthor` = the PR author login equals `gh api user -q .login`.
   - target = the PR base, else `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`.
   - headSha = `git rev-parse <arg>`. baseSha = `git merge-base origin/<target> <headSha>`.
   - If the diff is empty, say so and stop.
3. **Resume check.** Run `resume --dir .deltaview/reviews --ref <arg> --head <headSha>`. If it returns a path, skip to step 8, reusing that manifest, and tell the user decisions are being resumed. If an in-progress manifest exists for the ref but its sha differs, tell the user the earlier decisions weren't carried over.
4. **Checkout.**
   - `git worktree add <tmpdir> <headSha>`.
   - Copy every `.env*` file from the main checkout root that isn't tracked into the same relative path, with `cp` only. Never `cat` or echo them.
   - Append `.deltaview/` to `.git/info/exclude` if it's missing.
   - Detect the package manager from the lockfile and install.
5. **Init + env.**
   - Run `init` with `--out .deltaview/reviews/<slug>-<YYYYMMDD-HHMMSS>.json` in the main checkout.
   - If `newEnvVars` isn't empty, show a banner in the terminal listing them and ask the user to add them to `.env`. Then wait for confirmation and re-copy the env files.
6. **Tests.**
   - Detect the test command (`scripts.test`, otherwise the build-file equivalent), run it in the worktree, then `patch` the result as `{command, passed, summary}`.
   - Failing tests don't stop the review.
   - If no test command exists, record `{command: null, passed: null, summary: "no test command found"}`.
7. **Analyse + anchor.**
   - Read the manifest's hunks and build the items using the tier rules from the spec, copied into SKILL.md:
     - Direct, Indirect with a chain, or Backstage.
     - Tests are attached to the item for the code they test.
     - Shared code goes on one representative element, listed in `affects`.
     - "Appears unused" means no UI path and no callers, which the agent checks with grep.
     - Summaries cover what changed and its effect, in plain language.
   - Start the dev server with `run_in_background`, using the detected dev script, and read the port from its output.
   - For each Direct or Indirect item, `navigate` to `http://localhost:<devport><route>` and use `find` / `read_page` / read-only `javascript_tool` (`document.querySelectorAll(sel).length` only) to pick and verify a selector. Prefer `data-testid`, then role + name, then text, and avoid `nth-child`.
   - **Never click, type or submit.**
   - If an item can't be anchored, convert it to Backstage with `howToReach`.
   - Write the items JSON to the scratchpad, then run `add-items`. On a validation error, fix the items and retry until it passes.
8. **Serve.**
   - Start the dev server if it isn't running already.
   - Run `serve --manifest <p> --target http://localhost:<devport> --port <free port>` with `run_in_background`.
   - Open `proxyUrl` in a new Chrome tab and tell the user to review there and click Finish when done. If a login is needed, the user logs in themselves.
9. **On server exit.**
   - Report the review URL (or "no PR, manifest only"), the counts and the manifest path.
   - Stop the dev server and run `git worktree remove <tmpdir>`.
   - If the server exited with an error, show it and keep the worktree for a retry.

- [ ] **Step 1: Write** `SKILL.md`, `plugin.json`, `marketplace.json`, and `README.md` (the install commands from the spec, requirements, and what `.deltaview/` holds).
- [ ] **Step 2: Validate packaging.** Run `claude plugin validate .` if the CLI has it. Otherwise check that both JSON files parse with `node -e 'JSON.parse(require("fs").readFileSync(".claude-plugin/plugin.json"))'` and the same for `marketplace.json`.
- [ ] **Step 3: End-to-end dry run.**
  - Create a throwaway Vite app in the scratchpad (`npm create vite@latest -- --template vanilla`). Commit it on `main`.
  - Create branch `feat/demo` that changes a button label, adds a `fetch("/api/x")` call behind a button, adds a key to `.env.example` and adds a CI YAML.
  - From that repo, run `/deltaview feat/demo` with the local plugin (`claude --plugin-dir <this repo>`).
  - Verify:
    - the env banner names the new key;
    - the overlays appear on both buttons, the fetch one Indirect with a chain;
    - the CI file is in Backstage;
    - decisions persist;
    - Finish with no PR writes the manifest and `.md`;
    - re-running before Finish resumes;
    - the worktree is removed.
- [ ] **Step 4: Run** `node --test test/`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: /deltaview skill and plugin packaging`
