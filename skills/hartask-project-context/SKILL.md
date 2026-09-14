---
name: hartask-project-context
description: Use at the start of substantial work in a project that has Hartask, or when picking up something you did not start — what this project is, what was being worked on, and what is queued. Also when you have lost the thread mid-session.
---

# Recovering the thread

One call answers the cold-start questions. Make it before deciding what to do,
not after.

```
hartask_start_session          # or GET /api/context
```

It returns the Project Context, the task in progress, status counts, the last
checkpoint, the queue waiting to be claimed, and the index of the documents this
project keeps.

## Reading it

**Start from the checkpoint, not the task list.** `handoff.next_step` is the
single most actionable line anyone left you; the board tells you what exists,
the checkpoint tells you where the work stopped and why.

**The document index is there so you never have to guess.** Each entry has a
purpose line — one sentence saying whether it is worth opening. Open one when it
covers what you are about to touch, with `hartask_get_context_doc` or
`GET /api/contexts/<slug>`. The bodies are deliberately not in the briefing, so
reading the index costs nothing.

**Check `valid_as_of` before trusting a document.** It names the task it was
last known to be true as of. A document that is older than the part it describes
is worse than no document, because it is wrong with confidence.

## What not to do

**Do not pull more than you need.** `hartask://tasks` and `hartask://history/recent`
exist for when a question actually needs them. A briefing followed by four
speculative reads is slower than a briefing followed by work.

**Do not re-derive what is written down.** If the briefing names a document that
covers the area you are entering, reading it is cheaper than working it out
again — that is the entire reason it exists.

**If `onboarding` comes back in the payload**, this project has just adopted
Hartask and has no tasks yet. Follow `hartask/docs/FIRST-RUN.md`, and ask the
user before migrating anything, starting the server, or syncing.
