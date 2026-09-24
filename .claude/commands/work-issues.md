---
description: Work the next issue from ISSUES.md (one issue per run)
---

Work exactly one issue from `ISSUES.md` in the project root, then stop.

`ISSUES.md` has these sections, in order: **Inbox** (items start with `- `, below the
`<!-- Add issues below this line. -->` marker), **In progress**, **Needs input**, **Done**.
The user appends to the Inbox with `./issues` while you work, so re-read the file right
before every edit and change only the lines you mean to. Never rewrite the whole file.

1. **Pick.** If **In progress** already holds an item, a previous run was interrupted:
   resume it, checking the working tree for its partial changes. Otherwise take the
   *first* Inbox item. If both are empty, say "Inbox empty" and stop.
2. **Claim.** Move the item from the Inbox into **In progress**, replacing `_Nothing yet._`.
3. **Decide whether you can act.** If the issue needs a decision only the user can make, or
   you can't tell what's wrong, move it to **Needs input** as `- <original text>` followed
   by an indented `> Question: ...` line, restore `_Nothing yet._` under In progress, and
   stop. Don't guess on product decisions, but do use sensible defaults for small things.
4. **Fix it.** Find the root cause, keep the change as small as the issue needs, and follow
   the conventions of the surrounding code.
5. **Verify.**
   - Run `npm test` and `npx vite build`. Both must pass.
   - For UI changes, run `npx vite --port 5199 --strictPort` in the background, screenshot it
     with headless Chrome (`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
     --headless=new --window-size=1200,800 --virtual-time-budget=3000 --screenshot=<scratchpad>/shot.png http://localhost:5199/`),
     look at the image, then stop the server. Tauri APIs don't exist in a plain browser, so
     say plainly what you couldn't check this way.
   - If Rust or `src-tauri/capabilities` changed, say that a rebuild or restart is needed.
6. **Record.** Remove the item from In progress (restoring `_Nothing yet._`) and add an
   entry at the **top** of **Done** in the existing style: a bold title for the issue,
   then a short paragraph covering what was wrong, what changed and why, and how it was
   verified, including anything left unverified.
7. **Don't commit or push.** The user reviews and commits.

Finish with one line: the issue you worked, and how many items are left in the Inbox.
