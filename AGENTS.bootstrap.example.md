## Hartask

This project uses Hartask for local task, state and project-continuity
management. It lives in `./hartask/` and stores its state in a local SQLite
database.

Hartask is reached over HTTP on `http://localhost:43127`. If it does not
respond, start it with `npm run dev` inside `./hartask/` — do not read
`./hartask/data/hartask.sqlite` directly, and do not treat Hartask as
unavailable without trying to start it first.

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

`/api/prompts` and `/api/harness` are stubs, and `/api/mcp` is a placeholder,
not an MCP transport. There is no prompt queue to claim from yet, so ignore
any instruction to "take the next Hartask prompt" until those endpoints
return real data.
