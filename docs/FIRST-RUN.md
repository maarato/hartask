# First run — instructions for the coding agent

This project has just adopted Hartask. Read this once, at the start of the
first session after it was installed. After the board has tasks in it, this
file is no longer relevant: use `GET /api/context` like any other session.

## What Hartask is

Hartask is a local task and project-continuity control plane. It lives in
`./hartask/`, stores state in a local SQLite database, and answers on
`http://localhost:43127`.

It exists so that the human and you read the same project state. It holds:

- **Project Context** — what this project is, for someone returning to it cold.
- **Handoff** — where the last session left off and what to do next.
- **Tasks** — what remains, hierarchical, with canonical statuses.
- **Events** — what objectively happened, as an audit trail.

You are the orchestrator; Hartask is not. It gives you state and continuity, it
does not run your work.

## Ask before doing anything

**Do not migrate anything and do not start the server without asking first.**
Both are visible changes to the user's project, and the second one occupies a
port on their machine.

Ask these two questions and wait for an answer:

1. *"This project has a `tasks.md` with N items. Do you want me to migrate them
   into Hartask?"* — name the actual file and the actual count, so the user
   knows exactly what would be created.
2. *"Should I start Hartask on http://localhost:43127?"*

If the user declines either one, say what that means — without migration the
board stays empty, without the server neither of you can read it — and carry on
with whatever they actually asked for.

## Starting the server

From inside `./hartask/`:

```bash
npm install
npm run dev
```

The database is created on first request, so `npm run db:init` is optional. Do
not run `npm run db:seed`: that loads sample tasks and would mix demo data into
a real board.

## Migrating an existing task list

There is no importer, and deliberately so: task files vary too much for a
parser to be trustworthy. You read the file and create the tasks through the
API, which is exactly the judgement a parser could not apply.

A typical `tasks.md` maps like this:

```text
- [x] Set up the database          ->  status DONE
- [ ] Add authentication           ->  status BACKLOG, root task
  - [ ] OAuth                      ->  subtask of the line above
  - [ ] Refresh token              ->  subtask of the line above
```

- Checked items become `DONE`; unchecked become `BACKLOG`.
- Indentation becomes hierarchy, through `parent_id`.
- Headings usually describe groups: either make each one a root task and nest
  its items under it, or ignore them if they are only document structure. Say
  which one you chose.
- If the file marks something as in progress or blocked, use `IN_PROGRESS` or
  `BLOCKED` and carry the reason over.

Create a root task first, keep its numeric `id` from the response, then create
its children with that `parent_id`:

```bash
curl -X POST http://localhost:43127/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Add authentication","status":"BACKLOG","agent_id":"<your-id>"}'

curl -X POST http://localhost:43127/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"OAuth","status":"BACKLOG","parent_id":12,"agent_id":"<your-id>"}'
```

Once everything is migrated, **mark what the user is actually working on next
as `READY`**, and `IN_PROGRESS` if it is already underway. A board where
everything is `BACKLOG` or `DONE` has nothing actionable, so `/api/context`
comes back with `current_task: null` and the next session starts with no thread
to pull. Ask the user which one it is rather than picking for them.

Rules for the migration itself:

- **Do not invent tasks.** Migrate what the file says, nothing more. If a line
  is too vague to be a task, ask rather than guess.
- **Do not delete or edit `tasks.md`.** Whether it stays as the source of truth
  is the user's decision, not yours. Ask them once the migration is done.
- **Do not migrate twice.** Check `GET /api/tasks` first; if the board already
  has tasks, stop and ask.
- Migrate the file's own ordering as `priority` if it clearly implies one,
  otherwise leave priorities alone.

## Finish the first run properly

Once tasks exist, two things are still missing, and they are what makes the
next session cheap:

1. **Write the Project Context** — a short orientation for someone who has not
   opened this project in three months: purpose, architecture, main concepts,
   current maturity. Put it in `/summary`, or ask the user to.
2. **Write the first handoff:**

```bash
curl -X POST http://localhost:43127/api/handoff \
  -H 'Content-Type: application/json' \
  -d '{
    "current_task": "TASK-001",
    "done": "Migrated N tasks from tasks.md into Hartask",
    "current_state": "what works right now",
    "next": "the single next action",
    "problems": ["what is broken or blocked"],
    "important_files": ["path/to/file"],
    "agent_run_id": "<your-id>"
  }'
```

From then on the normal loop applies: read `GET /api/context` before
substantial work, move a task to `IN_PROGRESS` before starting it and to `DONE`
when it is finished, and write a checkpoint before you stop. See
`AGENTS.bootstrap.example.md` for the short version that belongs in the
project's own instructions file.
