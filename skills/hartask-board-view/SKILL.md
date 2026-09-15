---
name: hartask-board-view
description: Use when asked to see the board, the queue or the harness rather than one row — what is open, how the work is distributed, where the project stands. Also when a plain list would bury the answer.
---

# Showing the board, not listing it

```
hartask_list_tasks   { status }    the board as a hierarchy, with counts
hartask_start_session              counts, current task, queue, checkpoint
hartask_get_harness                what is configured on this disk
```

Over HTTP the same rows come from `/api/tasks`, `/api/context`, `/api/prompts`
and `/api/harness`.

## Hartask serves rows; the markup is yours

There is no `format=html`, deliberately. Markup that renders well has to carry
the host's own design tokens — its surfaces, its accent colour, its icon font —
and Hartask does not know them. A fragment built with Hartask's CSS arrives in
a chat window wearing foreign colours and inverts wrongly in dark mode.

The rows travel between hosts. The markup does not. So fetch the rows and build
the view against whatever the host you are running in can actually render.

## Check what your host renders before promising a picture

Most cannot. A terminal host has no HTML surface at all, and describing a chart
you never produced is worse than the list you skipped.

With no renderer, a markdown table is the answer — not a lesser one. Same rows,
same order, same identifiers.

## Render a shape, answer a lookup

**Worth rendering:** what is open and in what order, how the work splits across
categories, what the queue holds, where a project stands. Questions about
*shape*, where a list makes the reader do the counting.

**Not worth rendering:** one task, one status, one number. What `TASK-061` is
takes a sentence, and drawing it is ceremony.

A view that appears for every question teaches the user to scroll past it.

## What goes in it

**Only rows you actually fetched.** The failure mode here is a plausible number:
nobody can tell a wrong chart from a right one, so it gets believed and quoted
back later. If a count did not come from a call you just made, leave it out.

**The identifiers.** `TASK-061` is what the user types next to act on it. A
board with no ids is decoration.

**The next action, not only the status.** Counts say a board exists;
`next_action` in priority order says what to do on Monday.

## It lives in the conversation

What you render is gone when the conversation is. If the user wants something to
return to — a page to open tomorrow, a link to send someone — say so and ask.
That is a different mechanism, and a durable one is a decision they should make
rather than discover.

For the board as a working tool rather than a snapshot, Hartask already serves
its own UI on the configured port. Point at it instead of rebuilding it.
