---
description: Loop over ISSUES.md, working one issue per iteration
---

Invoke the `loop` skill with args `/work-issues` (no interval, so it self-paces).

Pacing for each iteration:
- If the Inbox still has items after an issue is done, wake again in about 60 seconds.
- If the Inbox is empty, check back in about 20 minutes (new items arrive via `./issues`).
- If an item was moved to **Needs input**, keep going with the rest of the Inbox.
- Stop the loop if the same issue fails twice in a row, and tell the user why.
