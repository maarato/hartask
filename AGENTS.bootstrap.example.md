## Hartask

This project uses Hartask for local task, state and project-continuity
management. It lives in `./hartask/` and stores its state in a local SQLite
database.

Hartask speaks MCP at `http://localhost:43127/mcp`. If your host can add an MCP
server, use that: `hartask_start_session` for the briefing,
`hartask_claim_next_prompt` for queued work, `hartask_update_handoff` before you
stop, and `hartask://` resources for state you only need to read.

Otherwise the same operations are plain HTTP on the same port, described below.

If Hartask does not respond, start it with `npm run dev` inside `./hartask/` —
do not read `./hartask/data/hartask.sqlite` directly, and do not treat Hartask
as unavailable without trying to start it first.

### First time in this project

If `GET /api/context` comes back with an `onboarding` block, Hartask has never
been used here. Follow `./hartask/docs/FIRST-RUN.md`, which covers migrating an
existing task list — and ask the user before migrating anything or starting the
server.

### At the start of substantial work

```
GET /api/context
```

Returns the cold-start briefing: project context, the task in progress, task
counts per status, recent events and the current handoff. Read it before
reconstructing project state from the code.

### While working

```
GET   /api/tasks                 list and hierarchy
GET   /api/tasks/TASK-001        one task with its notes and events
POST  /api/tasks                 create   { title, status, next_action, parent_id }
PATCH /api/tasks/TASK-001        update   { status, next_action, blocked_reason, note, agent_id }
```

Move a task to `IN_PROGRESS` before working on it and to `DONE` when it is
finished. Status changes are recorded as events automatically; you do not need
to log them separately. Canonical states: `BACKLOG`, `READY`, `IN_PROGRESS`,
`BLOCKED`, `REVIEW`, `DONE`, `CANCELLED`.

### Taking queued work

```
POST /api/prompts/claim   { "agent_id": "your-id" }
```

Claim, never get: two agents calling this never receive the same prompt. When
you finish, close the attempt:

```
PATCH /api/prompts/{id}   { "action": "complete", "summary": "what you did" }
PATCH /api/prompts/{id}   { "action": "fail", "error": "what broke" }
```

Failing returns the prompt to the queue by default — the same instruction often
needs several tries, and every attempt is kept. Pass `"retry": false` to give up
on it instead.

### Before ending meaningful work

```
POST /api/handoff
{
  "current_task": "TASK-001",
  "done": "what was implemented",
  "current_state": "what works now",
  "next": "the single next action",
  "problems": ["what is broken or blocked"],
  "important_files": ["path/to/file.ts"],
  "agent_run_id": "your-agent-id"
}
```

Each checkpoint is a new row; the most recent one is the current handoff.
Write one after meaningful progress, an important decision, a discovered
blocker or a completed task — not after every file write.

### Not available yet

`/api/harness` is a stub and `hartask_get_harness` is not offered: the harness
scanner does not exist. Everything else described here works.
