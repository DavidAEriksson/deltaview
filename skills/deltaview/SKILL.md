---
name: deltaview
description: Visual, in-browser review of a branch or commit. Opens the running app in the reviewer's Chrome with overlays on every element the change affects, collects approve/reject/comment decisions and posts them as a GitHub review. Use for "/deltaview <branch|commit>" or when the user asks to visually review a branch, PR or commit.
argument-hint: <branch|commit>
---

# Deltaview

Review the ref `$ARGUMENTS` (call it `<ref>` below) against its target branch, with overlays on the running app.

`DV` below means `node "${CLAUDE_SKILL_DIR}/scripts/bin/deltaview.mjs"`, where `${CLAUDE_SKILL_DIR}` is the "Base directory for this skill" shown when this skill loaded. Always write it out as the absolute path.

Ground rules (never break them):
- **Never click, type or submit in the app.** In the app you may only navigate by URL, scroll and read. `javascript_tool` is for read-only queries (`document.querySelectorAll(sel).length`), never `.click()`, `dispatchEvent`, form changes or fetches.
- Never modify the reviewer's working copy. The only writes to the main checkout are under `.deltaview/` and one `.deltaview/` line in `.git/info/exclude`.
- Never read, print, echo, `cat` or edit `.env*` files. Copy them with `cp` only.
- Don't fix a failing install, app start or tests. Report and stop (start/install) or continue (tests).
- Shell variables don't persist between Bash calls: use absolute paths and literal values in every command.

## 1. Preflight

1. Run `gh auth status`. If it fails, warn: "gh is not authenticated: nothing can be posted to GitHub, the review is saved locally only". Continue, and skip every `gh` command below (pr = null).
2. Load the Claude in Chrome tools in ONE ToolSearch call: `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__find,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__tabs_close_mcp`. If they are unavailable, stop: "Deltaview needs the Claude in Chrome extension. Install/enable it and run /deltaview again."
3. The main checkout `<main>` is `git rev-parse --show-toplevel` of the current directory.

## 2. Resolve

1. If `<ref>` is empty, ask the user for a branch name or commit hash.
2. If `git rev-parse --verify --quiet '<ref>^{commit}'` fails, run `git fetch origin <ref>`; the head is then `FETCH_HEAD`. If the fetch also fails, stop: "ref not found: `<ref>`".
3. If `<ref>` is a branch name (not a hash), run `gh pr list --head <ref> --state open --json number,url,baseRefName,author,headRepositoryOwner`. If it fails (e.g. no GitHub remote) or returns `[]`, pr = null. If it returns a PR:
   - Always review the PR's current tip, not a possibly stale local branch: if `headRepositoryOwner.login` differs from the owner in `gh repo view --json owner -q .owner.login` (a fork PR) run `git fetch origin pull/<number>/head`, else `git fetch origin <ref>`. Use `FETCH_HEAD` as the head. If the fetch fails, stop: "ref not found: `<ref>`".
   - `isAuthor` = `author.login` equals `gh api user -q .login`.
   - pr = `{"number":<number>,"url":"<url>","isAuthor":<true|false>}`.
4. target = the PR's `baseRefName`, else `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, else `git symbolic-ref --short refs/remotes/origin/HEAD` without `origin/`, else `main` or `master` (whichever exists locally), else ask the user.
5. Run `git fetch origin <target>` (ignore failure if there is no remote). `<targetRef>` = `origin/<target>` if `git rev-parse --verify --quiet origin/<target>` succeeds, else `<target>`.
6. headSha = `git rev-parse <head>^{commit}` (head = `<ref>` or `FETCH_HEAD`); if it fails, stop: "ref not found: `<ref>`". baseSha = `git merge-base <targetRef> <headSha>`.
7. If `git diff --quiet <baseSha> <headSha>` exits 0, say "`<ref>` has no changes against `<target>`" and stop.

## 3. Resume check

`<slug>` = `<ref>` with every run of characters outside `A-Za-z0-9._-` replaced by `-` (e.g. `feat/demo` → `feat-demo`).

Run `DV resume --dir <main>/.deltaview/reviews --ref <ref> --head <headSha>`.
- If it prints a path, that is `<manifest>`. Tell the user "Resuming the unfinished review from <manifest>; earlier decisions are kept." Do step 4, then skip to step 8.
  `resume` only returns an `in_progress` manifest with this head sha AND at least one item; one left with no items (the earlier run stopped before step 7 finished) is ignored and a fresh review starts.
- If it prints nothing, run `DV previous --dir <main>/.deltaview/reviews --ref <ref> --head <headSha>`. If that prints a path, it is `<previous>` (an earlier review of `<ref>` at another commit, e.g. before the author pushed fixes). Tell the user: "Found an earlier review of `<ref>`; decisions on items whose changes are identical will be carried over, the rest are marked changed since your last review." It is used in step 7.

## 4. Checkout

1. `<wt>` = a new temp dir from `mktemp -d`. Run `git -C <main> worktree add --detach <wt> <headSha>`.
2. Copy untracked env files from the main checkout root, byte for byte, without reading them:
   `cd <main> && git ls-files -z --others -- ':(glob).env*' | xargs -0 -I{} cp {} <wt>/{}`
   (git pathspec, not a shell glob: works in zsh when no file matches.)
3. `grep -qxF .deltaview/ <main>/.git/info/exclude || echo .deltaview/ >> <main>/.git/info/exclude` (use `git rev-parse --git-common-dir` for the `.git` path if `<main>/.git` is a file).
4. Install in `<wt>`, picking the package manager from the lockfile: `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`; `yarn.lock` → `yarn install --frozen-lockfile` (Yarn 2+: `yarn install --immutable`); `bun.lockb`/`bun.lock` → `bun install`; `package-lock.json` → `npm ci`; only `package.json` → `npm install`; other build files (e.g. `pyproject.toml`, `Gemfile`, `pom.xml`) → their usual install. If unsure, ask the user. If the install fails, show the error, remove the worktree and stop.

## 5. Init + env

1. `<manifest>` = `<main>/.deltaview/reviews/<slug>-<YYYYMMDD-HHMMSS>.json` (local time, `date +%Y%m%d-%H%M%S`).
2. `DV init --repo <main> --ref <ref> --target <target> --base <baseSha> --head <headSha> --out <manifest>`, plus `--pr '<pr json>'` if there is a PR.
3. `DV env --repo <main> --base <baseSha> --head <headSha>` prints the new env var names as a JSON array. If it isn't empty, show a banner in the terminal:
   ```
   ⚠ This change adds env vars: NAME_1, NAME_2
     Add them to your .env (in <main>) before the app starts. Reply when done.
   ```
   Wait for the user's reply, then re-run the copy command from step 4.2.

## 6. Tests

1. Detect the test command: `scripts.test` in `<wt>/package.json` run with the detected package manager (`npm test`, `pnpm test`, …), else the build-file equivalent (`pytest`, `go test ./...`, `cargo test`, `mvn test`, `./gradlew test`, `bundle exec rspec`). Skip npm's placeholder `echo "Error: no test specified" && exit 1`.
2. Run it in `<wt>` (timeout up to 10 minutes) and judge pass/fail by its exit code; don't pipe it through `tail`, which hides the exit code. Failing tests don't stop the review.
3. `DV patch --manifest <manifest> --json '{"tests":{"command":"<cmd>","passed":<true|false>,"summary":"<one line, e.g. 12 passed, 1 failed>"}}'`. With no test command: `{"tests":{"command":null,"passed":null,"summary":"no test command found"}}`.

## 7. Analyse + anchor

### Analyse
List the hunks: `node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1]));for(const h of Object.values(m.hunks))console.log(h.id,h.status,h.file,"@"+h.newStart,"+"+h.lines.filter(l=>l.type=="add").length,"-"+h.lines.filter(l=>l.type=="del").length)' <manifest>`. Read the diff (`git -C <main> diff <baseSha>...<headSha>`) and the code around it in `<wt>`.

Group hunks into items. **Every hunk belongs to exactly one item.** If step 3 found `<previous>`, read its items first and keep their grouping, titles, routes and selectors for code that hasn't changed: a decision only carries over when an item's set of edits is identical. One file may be split across items if its hunks belong to different features. Tiers:
- **direct**: the changed code renders something (component, template, markup, styles). The overlay sits on that element.
- **indirect**: the changed code is non-visual (API handler, hook, service, util, store) but something on screen triggers it. Trace the chain from the trigger to the changed code (grep for callers, read imports, use framework knowledge) and pin the overlay to the trigger. `chain` is the breadcrumb from trigger to change, e.g. `["Save button","useSaveOrder()","POST /api/orders","orders.handler.ts"]`. Put the item's hunks in chain order.
- **backstage**: no path to the UI (migrations, CI, config, build files, docs, lockfiles) or UI that can't be anchored. Set `howToReach` when it's UI that needs a manual interaction (e.g. "Open Settings, click Billing, then Edit").
- Tests: attach test hunks to the item for the code they test, not to their own item.
- Shared code used by many elements: pin it to ONE representative element and list the others in `affects` (e.g. `["Checkout › Pay button"]`). If the instances on that route share a stable selector (e.g. `[data-testid="price-tag"]`), use it: the overlay outlines the first match and shows the other matches as dim outlines.
- `appearsUnused: true` only when the changed code has no UI path AND nothing calls it. Check with grep across `<wt>` (excluding the definition and tests) before setting it.
- `summary`: plain language, what changed and its effect on the component or behaviour. Mention risks you noticed. No secret values.

Item shape (the CLI sets `visuallyVerified`, `decision`, `comment`, `decidedAt`):
```json
{"id":"i1","tier":"direct","title":"Save button","route":"/orders/new","selector":"[data-testid=\"save\"]",
 "chain":[],"affects":[],"hunkIds":["h1","h4"],"summary":"…","howToReach":null,"appearsUnused":false}
```
`route` is a URL pathname only (no query or hash; the overlay matches on `location.pathname`). `selector` is a CSS selector for `document.querySelectorAll`; the first match is the anchor. Backstage items use `"route":null,"selector":null`.

### Start the app
1. Detect the dev command: `scripts.dev`, else `scripts.start`, else `scripts.serve` (run with the detected package manager), else the framework/build-file equivalent; if unsure, ask the user.
2. Start it in `<wt>` with Bash `run_in_background`. Read its output until it prints a URL or port; `<devUrl>` = that origin exactly as printed (keep `localhost` vs `127.0.0.1`). If it exits or prints an error instead, show the error to the user, stop, remove the worktree.

### Anchor (Chrome, read-only)
1. `tabs_context_mcp`, then `tabs_create_mcp` for a new tab. Work only in that tab.
2. For each direct/indirect item, `navigate` to `<devUrl><route>`, then use `find` / `read_page` to locate the element and `javascript_tool` with ONLY `document.querySelectorAll(<selector>).length` to check the selector matches. It must match exactly 1 element, except for shared code (below), where it may match every instance of the changed component and nothing else.
3. Selector preference: `[data-testid="…"]` (or `data-test`, `data-cy`) → id → ARIA (`[aria-label="…"]`, `[role="…"][aria-label="…"]`, `a[href="…"]`, `button[name="…"]`) → a short structural selector built from stable attributes. Avoid `nth-child`/`nth-of-type` and generated class names. If no CSS selector is unique and stable, ask yourself whether a nearby stable container works; otherwise make it backstage.
4. **Never click, type, hover-to-open or submit.** If the element only appears after an interaction (modal, closed tab, later form step, logged-in area you can't see) or can't be anchored for any other reason, convert the item to `backstage` with `howToReach`. If the app shows a login page, ask the user to log in themselves in that tab, then continue.
5. Write the items as a JSON array to a file in your scratchpad, then `DV add-items --manifest <manifest> --items <file>`, plus `--carry-from <previous>` if step 3 found one (it prints how many decisions carried over; tell the user). If it fails, it lists every problem (uncovered hunk, duplicate hunk, missing route/selector/summary): fix the items and rerun until it succeeds.
6. Close the anchoring tab with `tabs_close_mcp`.

## 8. Serve

1. If the dev server isn't running (e.g. when resuming), start it as in step 7 "Start the app".
2. Before/after (optional). If there is at least one direct or indirect item, ask: "Also start the base version (`<target>` at `<baseSha>`) for a side-by-side before/after view? It takes a second install and dev server." If yes:
   1. `<bwt>` = a new `mktemp -d`. `git -C <main> worktree add --detach <bwt> <baseSha>`, copy the env files into `<bwt>` with the step 4.2 command, and install as in step 4.4.
   2. Start its dev server as in step 7 "Start the app", in `<bwt>`. It must listen on a different port than `<devUrl>`: most dev servers pick the next free port; if it fails because the port is taken, pass the framework's port flag with a free port. `<baseDevUrl>` = the URL it prints.
   3. If the install or start fails, tell the user, remove `<bwt>` and continue without before/after.
3. Pick a free port: `node -e 's=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})'`.
4. Start `DV serve --manifest <manifest> --target <devUrl> --port <port>` (plus `--base-target <baseDevUrl>` if step 2 started one) with Bash `run_in_background`. Its first output line is `{"proxyUrl":"…","port":…,"baseUrl":…}`. If it exits with `deltaview: …` instead, show the error and pick another port once.
5. `tabs_context_mcp` (needed when resuming, which skips step 7), then `tabs_create_mcp` and `navigate` to `proxyUrl` (keep `#` fragments off). Tell the user:
   "Review is open in Chrome at <proxyUrl>. The Deltaview bar is bottom-left: click an item to see its diff and summary, then approve / reject (reason required) / comment. Keys: j/k previous/next item, n next undecided, a/r/c approve/reject/comment, Esc close. Backstage items are in the drawer. Click **Finish review** when done. If the app needs a login, log in yourself in that tab."
   With before/after, add: "**Before ⇄ after** in an item's panel shows the same page before the change on the right."
6. Don't poll. The serve process exits when the reviewer clicks Finish, and you're re-invoked then. Decisions are saved to `<manifest>` immediately; if the session is interrupted, running `/deltaview <ref>` again resumes.

## 9. On server exit

1. If it exited 0, its last output line is `{"done":true,"reviewUrl":…,"manifestPath":…}`. Read `<manifest>` and report:
   - the review URL, or "No open PR: nothing posted, manifest only";
   - counts: approved / rejected / commented / undecided of N items, and how many are backstage ("not visually verified");
   - the test result and any new env vars;
   - `<manifest>` and the sibling `.md` path.
   If GitHub posting failed, the overlay showed the error and the reviewer can click Finish again; the manifest's `error` field holds it.
2. Stop the dev server (stop its background task, or kill the process listening on the dev port), and the base dev server if step 8.2 started one. Run `git -C <main> worktree remove --force <wt>` (`--force` because install/build artifacts are untracked), then `rm -rf <wt>` if it remains; the same for `<bwt>`.
3. If the serve process exited with an error (non-zero), show the error, stop the dev server and keep `<wt>` so the user can retry; tell them its path.
