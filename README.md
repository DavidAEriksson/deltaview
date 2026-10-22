# Deltaview

Visual, in-browser review of a branch's changes, as a Claude Code plugin. Run `/deltaview <branch|commit>` and your app opens in your own Chrome with an overlay on every on-screen element the change affects. Open an overlay to see its diff and a plain-language breakdown, then approve, reject (with a reason) or comment. Changes with no place on screen (CI, migrations, config, unreachable UI) are in the Backstage drawer, tagged "not visually verified". Clicking **Finish review** posts one GitHub review to the open PR and saves a manifest a follow-up agent can act on.

## Install

```
/plugin marketplace add DavidAEriksson/deltaview
/plugin install deltaview@deltaview
```

For local development: `claude --plugin-dir /path/to/deltaview`.

## Update

Refresh the marketplace to fetch the latest release, then restart Claude Code so the new version loads:

```
/plugin marketplace update deltaview
```

If the old version still loads after the restart, open `/plugin`, go to the installed plugins, and update deltaview from there. To update automatically, turn on auto-update for the deltaview marketplace under `/plugin` → Marketplaces. Each release's changes are in [CHANGELOG.md](CHANGELOG.md) and on the [releases page](https://github.com/DavidAEriksson/deltaview/releases). `/plugin` shows which version is installed.

## Usage

```
/deltaview feat/my-branch
/deltaview 3f2c1ab
```

The skill is `/deltaview:deltaview`; the bare `/deltaview` works too unless another command already has that name.

Deltaview checks the ref out in a temporary git worktree (your working copy is untouched), copies your untracked `.env*` files into it, installs dependencies, runs the tests, starts the dev server and a small local proxy that injects the overlay. The agent only navigates and reads the page while anchoring overlays; it never clicks in your app. If you stop before finishing, running `/deltaview` on the same ref and commit resumes with your decisions kept.

## Requirements

- Claude Code with the [Claude in Chrome](https://claude.com/chrome) extension connected (required).
- Node.js 20 or later.
- `gh` CLI authenticated with access to the repo, to post reviews. Without it the review is saved locally only.
- A web project whose dev server already runs locally with your existing env.

## What `.deltaview/` holds

Deltaview writes only to `.deltaview/` in your main checkout and adds `.deltaview/` to `.git/info/exclude`, so it never shows in `git status`.

- `.deltaview/reviews/<ref>-<YYYYMMDD-HHMMSS>.json`: the manifest. Ref, base and head SHAs, PR, test result, new env vars, every diff hunk and every item (tier, route, selector, chain, summary, decision, comment, visually verified, appears unused). Written on every decision.
- `.deltaview/reviews/<ref>-<YYYYMMDD-HHMMSS>.md`: a human-readable rendering of the same manifest.

## Development

```
npm test
```

No dependencies: the toolkit in `skills/deltaview/scripts/` uses Node built-ins only.

## Releases

Versions follow [semver](https://semver.org) and are cut by [release-please](https://github.com/googleapis/release-please) from [Conventional Commits](https://www.conventionalcommits.org) on `main` (`fix:` → patch, `feat:` → minor, `feat!:` / `BREAKING CHANGE:` → major). It keeps an open release PR that bumps `package.json`, `.claude-plugin/plugin.json` and `CHANGELOG.md`; merging it tags the release and publishes a GitHub release.
