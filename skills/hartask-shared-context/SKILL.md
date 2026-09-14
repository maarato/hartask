---
name: hartask-shared-context
description: Use when something was worked out that would otherwise be derived again next session — how a part of the system works and why, what was decided and discarded, what is actually verified. Also when deciding where a piece of writing belongs.
---

# Writing something down where it will be found

```
hartask_get_context_doc    { slug }                read one in full
hartask_write_context_doc  { slug, title, ... }    create or correct one
```

The index of what exists rides in every briefing, so you never have to guess
whether a document is already there.

## Read the index before writing

Correcting a document in place is almost always right. Two documents on the same
subject mean neither can be trusted, and nobody can tell which one is current.

Writing a slug that exists corrects that document; fields you leave out keep
what it already says, so fixing a body does not mean restating the title.

## Where each thing goes

Filed in the wrong place, a piece of writing is worse than not written: a
checkpoint saved as a document claims to be current forever, and a durable
decision saved as a checkpoint is buried under the next one within a day.

First, the question that comes before the other four:

> **If it must travel with a clone of the repo, it goes in the repo** — README,
> AGENTS.md, docs/. **If it describes the ongoing work of this project, it goes
> in Hartask.**

A coding convention is never a shared context: a fresh clone takes AGENTS.md and
takes none of the rows.

Then:

| | Holds | Shape |
| --- | --- | --- |
| Project Context | What the project **is** | One document, a minute to read |
| Shared context | How a **part** works and why | Named documents, corrected in place |
| Handoff | Where you **left off** | A checkpoint, point in time |
| Task note | What you found doing **this task** | Attached to that task |

**Would it be stale in a week?** Then it is a handoff or a note, not a document.
A shared context claims to be current, and anything that expires quickly should
not make that claim.

**Is it longer than a minute's reading?** Then it does not belong in Project
Context, whatever else is true. That budget is why Project Context works, and
the overflow is what shared contexts exist to catch.

## Keeping the shelf worth reading

Set `valid_as_of` to the task it was last true as of. A document that admits its
age is worth more than one that quietly claims to be current.

A shelf of stale pages is a shelf a reader learns to skip, so the failure mode
here is not a missing document — it is one nobody trusts. Removing one that
stopped being true is maintenance, not loss; ask the user to do it from the
Contextos tab, because a person clearing out their own writing is ordinary and
an agent doing it quietly is not.

Full reasoning: `hartask/docs/WHERE-IT-GOES.md`.
