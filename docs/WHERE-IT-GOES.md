# Where it goes

Hartask holds five kinds of prose, and the hard part of using it is not the API
— it is knowing which one you are holding. Something filed in the wrong place is
worse than something not written down: a checkpoint saved as a document claims
to be current forever, and a durable decision saved as a checkpoint is buried
under the next one within a day.

## The first question: git or a row

Before choosing between the four below, decide whether it belongs in Hartask at
all.

> **If it has to travel with a clone of the repo, it goes in git** — `README.md`,
> `AGENTS.md`, `docs/`. **If it describes the ongoing work of this project, it
> goes in a row.**

A convention about how the code is written is never a shared context: a fresh
clone takes `AGENTS.md` with it and takes none of the rows. A decision about
what this project tried and reverted is never a doc in `docs/`: it is about the
work, it cites task ids, and it is what you want to read from another machine.

## The four homes

| | What it holds | Shape | Written when |
| --- | --- | --- | --- |
| **Project Context** | What the project **is** | One document, mutable, budgeted at one minute to read | A major architectural or product change |
| **Shared context** | How a **part** works and why | Named documents, mutable, corrected in place | Something was worked out that would otherwise be derived again |
| **Handoff** | Where you **left off** | A checkpoint, point in time, append-only | After meaningful work and before stopping |
| **Task note** | What you found doing **this task** | Append-only, attached to the task | While working on that task |

## The test, when it is not obvious

**Would it be stale in a week?** Then it is a handoff or a note, not a document.
A shared context claims to be current; anything that expires quickly should not
make that claim.

**Who needs it?** The next session → handoff. Whoever touches this task → a
note. Anyone who touches this part of the system → a shared context. Someone
opening the repo in three months → Project Context, or git.

**Is it longer than a minute's reading?** Then it does not belong in Project
Context, whatever else is true. That budget is the whole reason Project Context
works, and the overflow is what shared contexts exist to catch.

## Hygiene, so the shelf stays worth reading

**Before creating a document, look at what is already there.** The index rides
in every `GET /api/context` briefing precisely so this costs nothing. Correcting
an existing document in place is almost always right; a second document on the
same subject means neither can be trusted.

**Say what it was last true as of.** `valid_as_of` takes a task id. A document
that admits its age is worth more than one that quietly claims to be current.

**A document nobody opens is worse than no document.** The failure mode of this
feature is not a missing page, it is a shelf of stale pages that a reader learns
to skip. Removing one that stopped being true is maintenance, not loss —
Hartask's UI removes documents; the MCP tools deliberately cannot, because a
person clearing out their own writing is ordinary and an agent doing it quietly
is not.

## Where this is repeated, and why

These rules appear in `AGENTS.md`, in `AGENTS.bootstrap.example.md`, in the
agent contract that `/mcp` serves, and in the description of
`hartask_write_context_doc`. That is deliberate duplication: a skill only runs
if the host supports skills, so rules that live only in one would work in Claude
Code and fail silently in Codex or Cursor. The tool description is the one an
agent reads without fail, so it carries the operative version; this file carries
the reasoning.
