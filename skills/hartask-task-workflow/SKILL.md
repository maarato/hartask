---
name: hartask-task-workflow
description: Use when creating, taking, progressing, blocking or finishing a task in a project that has Hartask — including deciding whether something you noticed deserves a task of its own.
---

# Moving work across the board

```
hartask_claim_task   { id }                 before starting
hartask_update_task  { id, status: 'DONE' } when it is finished
```

States: `BACKLOG` → `READY` → `IN_PROGRESS` → `REVIEW` → `DONE`, with `BLOCKED`
and `CANCELLED` off to the side. A status change records its own event — do not
log it separately.

## Writing a task someone else can act on

A task is read by whoever picks it up, which may be you in three weeks with none
of today's context. What makes one usable:

- **What is wrong, not just what to build.** The failure it prevents is the part
  that survives; the implementation you imagined today may not be the one that
  ships.
- **What you already checked.** Naming the file and line you verified saves the
  next person the search, and stops them re-deriving a dead end.
- **How you would know it is done.** A task that cannot be closed with confidence
  stays open forever.
- **Decisions you deliberately left open**, and the options. A task that hides a
  fork gets resolved by whoever gets there first, silently.

`parent_id` nests a task under a goal. A subtask takes its parent's category
unless you pass one, so filtering by area shows the work and not just its
headings.

## When to open one instead of fixing it now

Open a task when the fix would widen what you are doing beyond what was asked.
Fix it now when it is inside the change you are already making.

A task for something you noticed is worth more than a mention in a message: a
message is gone by tomorrow.

## Events and notes

**Events** are what happened; **notes** are what you wrote. Record an event when
something meaningful happened that a status change does not already say — a test
that failed for an interesting reason, a decision made, a blocker discovered.
Not every file write.

A note belongs on a task when it is about *that* task. What you learned about
how a part of the system works belongs in a shared context instead, so the next
person finds it without knowing which task to look under — see
`hartask-shared-context`.
