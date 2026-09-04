# Hartask — agent instructions

Hartask is a local, project-scoped continuity and task control plane for humans
and coding agents. Read `README.md` for the methodology and
`docs/NEXT-STEPS.md` for the implementation order.

This repository is Hartask itself, so Hartask runs from the repository root
rather than from a `./hartask/` subfolder. `AGENTS.bootstrap.example.md` is the
file a *consuming* project copies into its own instructions; it is not the file
you follow here.

## Use Hartask while working on Hartask

The board for this project lives in Hartask. Start the server with
`npm run start` (or `npm run dev`) and use the HTTP API:

```
GET   /api/context               cold-start briefing: read this first
GET   /api/tasks                 list and hierarchy
PATCH /api/tasks/TASK-001        { status, next_action, blocked_reason, note, agent_id }
POST  /api/handoff               checkpoint before ending meaningful work
```

Move a task to `IN_PROGRESS` before starting it and to `DONE` when it is
finished; status changes record events on their own. Write a handoff checkpoint
after meaningful progress, an important decision, a discovered blocker or a
completed task.

Never read or write `data/hartask.sqlite` directly from application code or as
an agent — that is the rule Hartask asks of its own users. Development scripts
under `scripts/` are Hartask, so they may open the database.

If the database is empty, `node scripts/dev/load-roadmap.mjs` reloads this
project's backlog through the API. `npm run db:seed` is the generic product
seed and is not this project's board.

## Verifying a change

```bash
npm run typecheck && npm run build
```

Both must pass. There are no tests yet — adding them to the repository layer is
`TASK-007` on the board.

## Conventions this codebase already follows

- **Repositories own SQL.** Route handlers and pages call
  `lib/hartask/repositories/*`; they never write queries inline.
- **Server-rendered, no client JS.** Pages are server components and mutations
  go through server actions. No `'use client'` has been needed so far —
  disclosure uses native `<details>`/`<summary>`, including the task cards,
  which are collapsed by default.
- **Any page or route that reads the database sets `export const dynamic =
  'force-dynamic'`**, otherwise Next tries to prerender it at build time.
- **`better-sqlite3` is a native addon** and is listed in
  `serverExternalPackages` in `next.config.mjs`. It cannot be bundled.
- **Validate at the API boundary** with the guards in `lib/hartask/types.ts`,
  and return 400/404 rather than letting a bad value reach SQLite.
- **Events are meaningful, not exhaustive.** A status transition is an event; a
  rename is not. Do not log every write.
- **Statuses live in one place**: `TASK_STATUSES` in `lib/hartask/types.ts`,
  matching the CHECK constraint in `lib/db/schema.sql`. Change both together.
- **A new column goes in two places**: `lib/db/schema.sql` for fresh databases
  and `ADDED_COLUMNS` in `lib/db/client.ts` for existing ones. Skipping the
  second leaves every current database silently without the column.

## Keep the documentation honest

`README.md` separates what works end to end from what is schema only, and
`docs/NEXT-STEPS.md` tracks the order and the known gaps. When you implement
something, move it between those sections in the same change. Claiming an
unimplemented capability is worse than an empty section, because both a human
and an agent will act on it.
