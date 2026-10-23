---
name: fix
description: Fix the rejected and commented items from a finished Deltaview review, in the reviewed branch, then offer to re-review. Use for "/deltaview:fix [ref|manifest]" or when the user asks to address, fix or act on Deltaview review feedback.
argument-hint: "[ref|manifest.json]"
---

# Deltaview fix

Act on the feedback in a Deltaview review manifest (`.deltaview/reviews/*.json`, written by `/deltaview`).

Ground rules:
- Never read, print, echo, `cat` or edit `.env*` files.
- Don't commit, push or post anything unless the user says so.
- Fix only what the feedback asks for. If a reason is unclear or you disagree with it, say so and ask instead of guessing.

## 1. Find the manifest

`<main>` = `git rev-parse --show-toplevel`. `$ARGUMENTS`:
- a path ending in `.json`: that is `<manifest>`;
- a ref (branch name): the newest `<main>/.deltaview/reviews/<slug>-*.json` whose `ref` equals it, where `<slug>` is the ref with every run of characters outside `A-Za-z0-9._-` replaced by `-`;
- empty: the newest `<main>/.deltaview/reviews/*.json` by file name timestamp (the part after the slug).

Prefer a manifest with `"status":"finished"`. If the newest one is `in_progress`, tell the user the review isn't finished and ask whether to use it anyway. If none exists, stop: "No Deltaview review found. Run /deltaview <branch> first."

## 2. List the feedback

```
node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log("ref",m.ref,"head",m.headSha,"pr",m.pr?.url??"none");for(const i of m.items)if(i.decision==="rejected"||i.decision==="comment"){console.log("\n##",i.id,i.decision.toUpperCase(),i.title,i.tier==="backstage"?"(not visually verified)":"");console.log("reason:",i.comment);const l=i.line&&m.hunks[i.line.hunkId].lines[i.line.index];if(l)console.log("on line:",m.hunks[i.line.hunkId].file+":"+(l.newLine??l.oldLine),l.text);console.log("summary:",i.summary);for(const id of i.hunkIds){const h=m.hunks[id];console.log("--",h.file,"@"+h.newStart);for(const l of h.lines)console.log((l.type==="add"?"+":l.type==="del"?"-":" ")+l.text)}}' <manifest>
```

If nothing is rejected or commented, say so (everything was approved or left undecided) and stop. Show the user a short numbered list: id, rejected/comment, title, reason.

## 3. Check out the branch

The fixes go on the reviewed ref, in the user's working copy.
1. If `git status --porcelain` is not empty, ask the user to commit or stash first, and stop until they reply.
2. If the current branch isn't the manifest's `ref`, ask before running `git checkout <ref>`.
3. If `git rev-parse HEAD` differs from `headSha`, tell the user the branch has moved on since the review (someone may already have fixed some items) and check each item against the current code.

## 4. Fix

For each item, rejected ones first:
1. Read the files in its hunks at their current state, plus the code around them. The hunks show what the review saw; `reason` says what is wrong.
2. A `comment` item may be a question or a remark rather than a change request. Make a change only if it asks for one; otherwise note it for the summary.
3. Make the smallest change that addresses the reason. Keep the code style of the surrounding file.
4. After all items, run the project's test command (the manifest's `tests.command`, if it isn't null) and report the result.

## 5. Report and hand back

List each item as fixed (what changed, which files), not changed (why, e.g. a question that needed an answer), or needs the user's input. Then ask whether to commit. When the fixes are pushed, offer: "Run `/deltaview <ref>` to re-review: decisions on unchanged items carry over, and the items you fixed show as changed since your last review."
