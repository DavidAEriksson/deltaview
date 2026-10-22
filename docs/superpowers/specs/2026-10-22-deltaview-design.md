# Deltaview — Design

Date: 2026-10-22
Status: Draft for approval

## Intent

Large PRs (e.g. 77 files, 5000+ LOC, often agent-written) pass the build and tests but are still hard to review: there is no clear entry point, and visual confirmation is hard. Today the reviewer runs the tests, then pulls the branch locally and clicks around wherever they suspect risk.

Deltaview makes that "pull it and click around" step guided. You run `/deltaview <branch|commit>` in Claude Code; your app opens in your own Chrome with overlays on every on-screen element affected by the change. Click an overlay to see the diff beside the element and the agent's plain-language breakdown, then approve, reject (with reason) or comment. When you finish, the review goes to the GitHub PR automatically and a detailed manifest is saved for humans or follow-up agents.

## Goals

- Run on any branch name or commit hash.
- Stack-agnostic for web projects: the agent works out how to install, test and start the app from `package.json` or other build files, the way a new team member would.
- Every changed file ends up somewhere the reviewer can see and decide on: on an overlay, or in the Backstage tray.
- Changes are shown where they take effect, including non-visual changes (APIs, hooks, utils) traced to the UI that triggers them.
- Per-overlay approve / reject / comment, saved immediately.
- Finishing posts a GitHub review automatically, without a confirmation step (the reviewer's job is done at that point).
- A machine-readable manifest of the whole review that an agent can act on later ("fix all rejected items").

## Non-goals (MVP)

- Setting up the reviewer's environment (secrets, databases, services). The reviewer's existing local env is assumed to work.
- Logging in for the reviewer. They log in themselves in their browser.
- Fixing a failing app start or failing tests. Report and stop or continue; don't repair.
- Supporting non-web apps (mobile native, CLI, desktop).
- Deep handling of non-visual changes beyond the Backstage tray (to explore later).
- Browsers other than Chrome.

## Anti-goals

- Marking a change "reviewed" when it was never shown visually. Anything not anchored to the UI must be clearly tagged "not visually verified" everywhere: overlay UI, GitHub comment, manifest.
- Modifying the target app's source code or the reviewer's working copy.
- Generating, editing, logging or printing secrets.
- Silently dropping changed files. Every file in the diff appears in the manifest.

## Constraints and decisions made

### Packaging
- A Claude Code **plugin**, distributed from the GitHub repo `DavidAEriksson/deltaview` (this folder):
  ```
  /plugin marketplace add DavidAEriksson/deltaview
  /plugin install deltaview@deltaview
  ```
- The plugin provides a `/deltaview` skill/command taking one argument: a branch name or commit hash.

### Browser
- Uses the reviewer's **own Chrome through the Claude in Chrome extension** (`mcp__claude-in-chrome__*` tools). The extension is a hard requirement; if it's unavailable, say so and stop.
- Reasons: the reviewer is likely already logged in to their localhost app, and overlays appear in their normal browser.

### GitHub
- Uses the `gh` CLI the reviewer is already authenticated with (my call). No extra tokens.
- Posting happens automatically on "Finish review".

### Environment
- Deltaview uses the reviewer's existing environment.
- If the branch is checked out separately (see "Checkout" below), local `.env*` files are copied into it first.
- **New env var detection:** compare `.env.example` (and similar template files), plus new `process.env.X` / `import.meta.env.X` references in the diff, between the base and the PR branch. Anything new or renamed is shown as a banner before the app starts ("This PR adds `STRIPE_WEBHOOK_SECRET`. Add it to your `.env`"), and is also listed in the review UI and the manifest.
- If the app fails to start, show the error to the reviewer and stop. Don't try to fix it.

### Tests
- Deltaview runs the project's test command (detected from build files) and shows the result at the top of the review UI, in the GitHub review body and in the manifest. (My call: the user runs tests first today, so this is included. Failing tests don't block the review.)

## How it works

### Flow of `/deltaview <ref>`
1. **Resolve.** Deltaview always reviews **a branch against its target**: the diff between the head and its merge-base with the target branch. The target is the open PR's base branch if there is a PR, otherwise the repo's default branch. A branch name uses the branch tip as the head. A commit hash uses that commit as the head, i.e. the branch as it stood at that commit, compared against its target. If the diff is empty (for example, the commit is already on the target), say so and stop.
2. **Checkout.** Check out the ref without touching the reviewer's working copy: a git worktree is my call. Copy `.env*` files across. Install dependencies.
3. **Env check.** Detect new env vars and warn as described above.
4. **Tests.** Run the tests and record the result.
5. **Analyse.** Read the full diff and put every changed file/hunk into one of three tiers (below). Trace indirect changes to the UI and write the agent's breakdown per overlay.
6. **Run.** Start the app's dev server, then the Deltaview server in front of it.
7. **Anchor.** Using Chrome, visit each relevant page, find the element for each overlay, record a stable selector plus the route to reach it, and verify it resolves. **The agent never clicks anything in the app.** It may only navigate by URL, scroll and read the page, so it can never trigger a side effect against the reviewer's backend. Elements that only appear after an interaction (modals, closed tabs, form steps) or can't be anchored for any other reason go to Backstage, with a note on how to reach them manually.
8. **Review.** Open the review tab in the reviewer's Chrome via the proxy URL. The reviewer works through the overlays.
9. **Finish.** "Finish review" makes the **Deltaview server** (not the agent) save the final manifest and post the GitHub review, using deterministic Node code. The server then prints a JSON summary and exits. The agent starts the server as a background process, so Claude Code re-invokes it when the server exits. The agent then reports in the terminal what was posted (link to the review). The review still posts even if the Claude session is gone. (My call.)

**Fetching (my call):** if the branch isn't local, fetch it from `origin`. If an open PR comes from a fork, fetch it the way `gh pr checkout` does.

### The three tiers
1. **Direct.** The changed code renders something (component, template, styles). The overlay sits on that element.
2. **Indirect.** The changed code is non-visual (API handler, hook, service, util) but something on screen triggers it. The agent traces the chain from the diff to the trigger and pins the overlay to the trigger. The overlay shows the chain as a breadcrumb, for example `Save button → useSaveOrder() → POST /api/orders → orders.handler.ts`. The diff panel holds every changed file on that path, in chain order.
   - Shared code used by many elements: pin it to one representative element and list the other affected elements in the panel.
   - Test files: attach them to the overlay of the code they test rather than reviewing them separately.
3. **Backstage.** No path to the UI (migrations, CI, config, unreachable UI). Shown in a Backstage drawer with the same diff, agent summary and approve/reject/comment controls, tagged **"not visually verified"**.
   - If changed code has no path to the UI **and** nothing calls it, flag it as "appears unused" (dead code is a common smell in agent-written PRs).

A single changed file may appear on more than one overlay if different hunks belong to different features. Every hunk belongs to exactly one overlay or Backstage item.

### Deltaview server (local, plain Node)
Plain Node, no framework and ideally no dependencies, so it is independent of the target project's stack (my call). It has three jobs:
1. **Proxy.** It runs in front of the dev server (e.g. `localhost:4500` → `localhost:3000`) and injects an overlay `<script>` into every HTML response. It must pass through WebSocket upgrades (hot module reload) and rewrite redirects that point at the dev server's origin. Cookies are shared across ports on localhost, so existing logins carry over.
2. **Data.** It serves the manifest (overlays, diffs, summaries, selectors) to the overlay script.
3. **Decisions.** It receives approve/reject/comment events and writes them to the manifest file on disk immediately. "Finish" triggers posting to GitHub.

### Overlay UI (injected into the app page)
Follows the user's mockups (dark theme): [Direct](assets/mockup-direct.png), [Indirect](assets/mockup-indirect.png).
- A label above the outlined element: `DELTAVIEW/<branch-name>`.
- An outline/box on the element (Direct or Indirect).
- When opened, a diff panel beside the element with added (green), changed (orange) and deleted (red) lines, plus the agent's plain-language breakdown of what changed and its effect on the component or functionality. Indirect overlays show the breadcrumb chain.
- An approve / reject / comment bar below the element. Rejecting requires a reason.
- A top bar listing every overlay across all pages with progress (e.g. "3/12 reviewed"), the test result, any new env var warnings and the Backstage drawer. Clicking an item navigates to its page and scrolls to the element.
- A "Finish review" button.
- Overlays re-attach when the DOM changes (SPA navigation, re-render) and must not break the app's own interactions while closed.
- Styles are isolated from the app (e.g. Shadow DOM) so neither breaks the other.

### GitHub posting
If an open PR exists for the branch:
- One GitHub review per session, posted via `gh` (the pull request reviews API).
- **Event:** `REQUEST_CHANGES` if anything is rejected; otherwise `APPROVE` if everything is approved; otherwise `COMMENT`.
- **Inline comments:** each overlay/Backstage decision becomes an inline comment on the changed lines it covers:
  - Approved: a short "✅ approved via Deltaview" note, so "reviewed and fine" is distinguishable from "nobody looked".
  - Rejected: the reason.
  - Comment: the comment text.
  - Backstage items are tagged "not visually verified".
- **Review body:** a summary of the overlays reviewed (counts), the test result, new env vars and a list of rejections.
- If the reviewer is the PR author, GitHub won't allow APPROVE/REQUEST_CHANGES on their own PR. Fall back to `COMMENT` and say so.

If there is no open PR (for example a bare commit), only write the manifest and tell the reviewer nothing was posted.

### Manifest
- Location: the reviewer's **main checkout** (not the worktree, which gets removed during cleanup), at `.deltaview/reviews/<branch-or-sha>-<timestamp>.json`, plus a human-readable `.md` rendering of it. `.deltaview/` is added to `.git/info/exclude`, so it never shows up in `git status` and no tracked file changes. (My call.)
- Contents: ref, base, head SHA, PR number/URL, test result, new env vars, and the list of items. Each item has: id, tier, page/route, selector, navigation steps, breadcrumb chain, files and line ranges (hunks), the agent's summary, decision (approved/rejected/comment/undecided), the reviewer's comment, visually verified (true/false), "appears unused" flag, and a timestamp. The GitHub review URL is added after posting.
- Written incrementally as decisions happen, so nothing is lost if the tab crashes.
- Designed for a follow-up agent to consume.

### Resuming
- Running `/deltaview` again on the same branch looks for the latest unfinished manifest for that branch (or commit). If its head SHA matches the current head, the session resumes: the same items and selectors, with existing decisions kept. The analysis and anchoring steps are skipped, but the app and servers are started again.
- If the head SHA has changed (new commits), start a fresh review and tell the reviewer that the earlier decisions were not carried over.
- A finished review (already posted) isn't resumed. Running it again starts a fresh review.

## Left to the builder

- Exact detection heuristics for package manager, dev/test commands and dev server port, as long as common setups (npm/pnpm/yarn/bun; Vite, Next.js, CRA, Remix, SvelteKit, Nuxt, Angular) work and it falls back to asking the reviewer.
- How the agent traces indirect chains (grep, reading imports, framework knowledge). The skill instructions guide this; no static analysis engine is required for the MVP.
- Selector strategy (prefer `data-testid`, ARIA role + name and text; avoid brittle nth-child).
- Mapping hunks to GitHub review comment `line`/`side`/`start_line` (deleted lines use `LEFT`), and handling lines outside the diff.
- Server port choice and collision handling.
- Cleanup on exit (stop servers, remove worktree) and whether `.deltaview/` should be suggested for `.gitignore`.
- Overlay visual polish beyond the mockups.
