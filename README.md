# Hartask

Hartask is a **local, project-scoped continuity and task control plane for humans and coding agents**.

It is not a SaaS, not a cloud service, not another coding agent, and not initially intended to replace the orchestrator already provided by Codex, Claude Code, Cursor or similar systems.

The intended usage is deliberately simple:

```text
my-project/
├── AGENTS.md
├── CLAUDE.md
├── src/
├── docs/
└── hartask/          <- extract/copy Hartask here
```

Hartask runs locally for that specific project, using a single process, a single five-digit port and a local SQLite database.

Default development URL:

```text
http://localhost:43127
```

The same server is intended to expose:

```text
/             Web UI
/api/*        Internal application API
/mcp          Agent interface (MCP)
/health       Healthcheck
```

The V1 philosophy is:

```text
Tasks         = What are we doing and what comes next?
Summary       = What is this project and where did we leave off?
Prompt Stack  = What work can an agent claim and execute?
Harness       = How is the project's AI environment configured?
Events        = What objectively happened?
Handoff       = What do those changes mean for the next session?
```

---

## Why Hartask exists

Coding agents are already capable of reading files, editing code, running tools and, depending on the host, using skills, hooks, MCP servers and browsers. The problem Hartask is trying to solve is not primarily code generation.

The problem is **project continuity**.

After a few days or weeks away from a project, a human often needs to reconstruct:

- what the project does;
- how its architecture works;
- what was being implemented;
- what is currently broken or blocked;
- what important decision was made;
- what should be done next.

Agents suffer from a similar cold-start problem. They may have the repository, but they still need to reconstruct current intent and operational state.

Hartask gives the human and the agent the same persistent project state.

```text
Human Context
      =
Agent Context
```

The human uses the web UI. The coding agent uses MCP/API. Both ultimately interact with the same Hartask Core and SQLite database.

---

# Core methodology

Hartask is intentionally centered around five concepts.

```text
HARTASK METHODOLOGY

1. PROJECT CONTEXT
   What is this project?

2. HANDOFF
   Where did we leave off?

3. TASKS
   What are we doing?

4. PROMPT STACK
   What should an agent execute?

5. HARNESS
   How is the agent environment configured?
```

The normal lifecycle is:

```text
                  PROJECT
                     │
              Project Context
                     │
                     ↓
                  Handoff
                     │
                     ↓
                   Tasks
                     │
                     ↓
                Prompt Stack
                     │
                     ↓
                  Agent
                     │
                     ↓
             meaningful changes
                     │
                     ↓
                  Events
                     │
                     ↓
              Update Handoff
```

The user is allowed to edit Hartask manually, but the design assumes that **agents perform most of the maintenance automatically**. Humans forget to update project notes; therefore continuity should be maintained as part of the agent workflow whenever possible.

---

# V1 UI

The initial UI should stay intentionally small.

```text
┌───────────────────────────────────────────┐
│ HARTASK                                   │
│                                           │
│ [ Tasks ] [ Summary ] [ Harness ]         │
└───────────────────────────────────────────┘
```

The first two views are the most important.

---

## 1. Tasks — primary view

Tasks answers four questions immediately:

```text
What am I doing?
What comes next?
What is blocked?
What should I work on first?
```

Tasks support hierarchy:

```text
Epic / Goal

└── Task
    ├── Subtask
    ├── Subtask
    │   ├── Subtask
    │   └── Subtask
    └── Subtask
```

Canonical V1 task states:

```text
BACKLOG
READY
IN_PROGRESS
BLOCKED
REVIEW
DONE
CANCELLED
```

A task card should eventually expose at least:

```text
TASK-42

Objective
Current status
Context
What was last done
Next action
Problems/blockers
Subtasks
Notes
History/events
```

The UI can default to a vertical cascade and later support a grid layout.

A task is not merely a Jira-style ticket. It is a **unit of context for both a human and an agent**.

---

## 2. Summary — cold-start view

Summary is intentionally composed of only two primary blocks.

```text
SUMMARY
│
├── Project Context
└── Last Context / Handoff
```

### Project Context

Project Context is a reduced README for a human who does not want to read the full project documentation.

Its goal is:

> If I have not opened this project for three months, I should understand what it is in roughly one minute.

It should contain only the information required to regain orientation, for example:

- project purpose;
- core architecture;
- principal technologies;
- important domain concepts;
- major modules;
- current overall maturity/status;
- one to three simple diagrams when they materially help.

A fenced ```mermaid block is drawn as a diagram in Summary; everything
around it stays the text it was. A diagram that fails to draw falls back to
its own source, which still says what the picture meant.

Example:

```text
PROJECT CONTEXT

BreinBread is a platform for agentic workflows and actuators.

Architecture

Next.js
   ↓
FastAPI
   ↓
PostgreSQL

Concepts

Workspace
  ↓
Project
  ↓
Brain
  ↓
Agent
  ↓
Actuator
```

Project Context changes slowly. It should only be refreshed for meaningful architectural/product changes such as major features, technology changes, modules being added/removed or important design decisions.

### Last Context / Project Handoff

This is the operational cold-start state.

It should answer:

```text
What was I working on?
What was completed?
What is the current state?
What is broken or blocked?
What should happen next?
Which files/decisions matter?
```

Example:

```text
LAST CONTEXT

Working on:
TASK-42 — Authentication

Last meaningful change:
JWT middleware and private-route protection added.

Current state:
OAuth works.
Login works.
Refresh token remains unfinished.

Known problem:
Two refresh-token tests fail because the mock lacks expires_at.

Recommended next step:
Fix the mock and finish refresh token support.

Important files:
src/auth/auth.service.ts
tests/auth-refresh.spec.ts
```

This information should be updated by the agent after **meaningful changes**, not after every file write.

Recommended update triggers:

- task started;
- meaningful implementation progress;
- important decision;
- blocker/problem discovered;
- task completed;
- meaningful failure;
- agent session about to end.

---

## 3. Harness

Harness is the diagnostic view of the project's effective AI harness.

It should inspect the project rather than duplicate the source-of-truth files.

Potential sources include:

```text
../AGENTS.md
../CLAUDE.md
../.agents/**
../.claude/**
../.cursor/**
../.codex/**
../hooks/**
MCP configuration
validation scripts
project documentation
```

The Harness view should eventually show:

```text
Harness
├── Diagram
├── Instructions
├── Skills
├── Hooks
├── Agents / Subagents
├── MCP
├── Tools
├── Permissions / Guardrails
└── Validators
```

Hartask should distinguish project-level and user-level skills where the host makes that information discoverable.

Harness source files should normally remain external. Hartask may persist metadata such as path, runtime, scope, hash and scan timestamp, but it should not become the canonical copy of AGENTS.md/CLAUDE.md/etc.

---

# Tasks, events and handoff are different concepts

These should not be collapsed into a single table or text blob.

```text
EVENTS
= what objectively happened

HANDOFF
= what the current situation means

TASKS
= what remains to be done
```

Example task events:

```text
10:31 TASK_STARTED
10:40 FILE_CHANGED auth.service.ts
10:52 TEST_FAILED
11:03 FILE_CHANGED auth.service.ts
11:06 TEST_PASSED
11:09 TASK_COMPLETED
```

The Handoff would summarize those events semantically:

```text
Authentication is mostly complete.
Refresh token support remains unfinished.
Two tests are currently failing.
```

This separation allows Hartask to preserve both an auditable history and a compact human/agent summary.

---

# Prompt Stack

Prompt Stack is a persistent queue of agent-executable instructions.

A user can add multiple prompts through the UI and later tell the coding agent:

```text
Take the next Hartask prompt.
```

Prompt lifecycle:

```text
DRAFT
  ↓
READY
  ↓
CLAIMED
  ↓
RUNNING
  ↓
DONE
```

Side states:

```text
FAILED
CANCELLED
```

A prompt is **not the same thing as a task**.

One task can require multiple prompts:

```text
TASK: Implement authentication

├── Prompt 1: Analyze current authentication
├── Prompt 2: Implement Google OAuth
├── Prompt 3: Add tests
├── Prompt 4: Review implementation
└── Prompt 5: Update documentation
```

Relationship:

```text
Task 1:N Prompts
Prompt 1:N Runs
```

Prompt Runs matter because the same prompt may fail and be retried:

```text
Prompt #18
"Fix authentication tests"

Run #201 FAILED
Run #202 FAILED
Run #203 SUCCESS
```

## Claim, do not just get

The agent-facing operation should be conceptually:

```text
hartask_claim_next_prompt()
```

rather than:

```text
hartask_get_next_prompt()
```

Claiming must be atomic so two agents cannot execute the same queued work.

The intended SQLite transaction is conceptually:

```text
BEGIN

select next READY prompt
update prompt -> CLAIMED by agent X
create prompt_run

COMMIT
```

This keeps the architecture multi-agent-safe without requiring a full orchestration framework in V1.

Future prompt dependencies can evolve into lightweight chains/workflows without requiring LangGraph immediately.

---

# Agent interface

Humans and agents use different interfaces over the same Hartask Core.

```text
        Web UI
           │
           ↓
      Hartask Core
           ↑
           │
        MCP / API
           ↑
           │
Claude / Codex / Cursor / other agents
```

The agent should **not query SQLite directly**.

Hartask should expose semantic operations such as:

```text
hartask_get_context
hartask_start_session
hartask_list_tasks
hartask_get_task
hartask_claim_task
hartask_update_task
hartask_add_note
hartask_claim_next_prompt
hartask_complete_prompt
hartask_fail_prompt
hartask_record_event
hartask_update_handoff
hartask_get_harness
```

Avoid generic database tools such as `query_sql` or `update_row`. Agents should depend on Hartask concepts, not the database schema.

---

# Hartask Agent Contract / bootstrap

Importing Hartask into a repository is not enough. The coding agent needs to discover that Hartask exists and understand how to use it.

The proposed solution has multiple lightweight layers.

## Layer 1 — tiny project bootstrap

The project's AGENTS.md/CLAUDE.md/etc. only needs a short pointer such as:

```text
## Hartask

This project uses Hartask for local task/state/project-continuity management.
It runs in ./hartask/ and answers on http://localhost:43127.

- Before substantial work, GET /api/context for the cold-start briefing.
- Move a task to IN_PROGRESS before working on it and to DONE when finished.
- Before ending meaningful work, POST /api/handoff with a checkpoint.
- Never access hartask.sqlite directly.
```

See `AGENTS.bootstrap.example.md` for the full version, and
`docs/FIRST-RUN.md` for what an agent should do the first time it finds a
project that has just adopted Hartask — including migrating an existing
`tasks.md`, and asking the user before doing so. `docs/INSTALL-PROMPT.md` is
what to hand that agent to get there: it covers cloning Hartask into the
project and picking a port, which are the two steps that happen before
`FIRST-RUN.md` has anything to describe.

The bootstrap must describe the interface that actually exists. Once the MCP
transport lands, the same pointer becomes a list of `hartask_*` tools; until
then it names HTTP endpoints, because an agent told about a tool that does not
exist fails on its first call.

The goal is not to copy the whole methodology into every project instruction file. The bootstrap should simply tell the agent:

```text
Hartask exists. Ask Hartask.
```

## Layer 2 — MCP server instructions

Hartask keeps its canonical agent behavior in `lib/hartask/contract.ts` and should expose it through MCP server instructions when the transport is fully implemented.

Core rules:

1. obtain Hartask context before substantial work when relevant;
2. claim queued work before executing it;
3. record meaningful events;
4. maintain the current handoff;
5. never manipulate the DB directly;
6. keep Project Context concise and Last Context actionable.

## Layer 3 — MCP resources/context

Proposed resources:

```text
hartask://project
hartask://project/summary
hartask://tasks
hartask://tasks/current
hartask://prompts/queue
hartask://harness
hartask://harness/skills
hartask://harness/hooks
hartask://harness/agents
hartask://history/recent
```

The exact MCP resource API can be finalized during implementation.

## Layer 4 — optional skills

Hartask should remain usable without host-specific skills. Skills enhance workflows.

Proposed V1 skills:

```text
hartask-project-context
hartask-task-workflow
hartask-prompt-runner
hartask-session-handoff
hartask-harness-inspector
```

See `docs/AGENT-SKILLS.md`.

The source-of-truth methodology should remain inside Hartask, with host-specific adapters generated later if needed.

---

# Session start and cold start

A particularly useful MCP tool is:

```text
hartask_start_session()
```

Its purpose is to return a compact operational briefing such as:

```text
Project: Example Project

Current work:
TASK-41 — Agent execution API

Current status:
IN_PROGRESS

Last session:
- Added executor service
- Migration pending
- 2 tests currently failing

Recommended next step:
Fix migration and rerun tests.

Queued prompts:
3

Relevant harness:
- backend-development skill
- documentation hook
- PostgreSQL MCP
```

This is the agent equivalent of the Summary screen.

The desired property is:

```text
Summary UI
    ≈
hartask_start_session()
```

Both should be generated from the same underlying state.

---

# Handoff updates

Hartask should expose a semantic operation such as:

```text
hartask_update_handoff
```

or a higher-level:

```text
hartask_checkpoint
```

The agent supplies the semantic state:

```json
{
  "current_task": "TASK-42",
  "done": "Implemented JWT middleware",
  "current_state": "OAuth login works",
  "next": "Implement refresh token",
  "problems": ["Two refresh-token tests fail"],
  "important_files": [
    "src/auth/auth.service.ts",
    "tests/auth-refresh.spec.ts"
  ]
}
```

Hartask can enrich that checkpoint automatically with timestamps, agent/run IDs, changed files, task events or git metadata when available.

Do not update the handoff after every individual tool call. Update it after meaningful state changes.

Where a coding host supports lifecycle hooks, a Stop/session-end hook can add a second safety net:

```text
Agent Stop
    ↓
Were there meaningful changes?
    ├── no  -> do nothing
    └── yes -> update handoff + record event
```

Hartask should not rely exclusively on hooks because capabilities differ across hosts.

---

# SQLite model

The starter schema currently includes:

```text
projects
tasks
task_notes
task_events
prompts
prompt_runs
project_handoff
harness_components
harness_scans
```

See:

```text
lib/db/schema.sql
```

SQLite is intentionally used because Hartask is project-local and should not require external infrastructure.

Important design choices:

- WAL mode enabled;
- foreign keys enabled;
- task hierarchy through `parent_id`;
- status constraints in the schema;
- events separated from task current state;
- prompts separated from prompt runs;
- handoff separated from task/event history;
- harness metadata stores paths/hash/scope rather than becoming the source of truth;
- `tasks.archived_at` is orthogonal to `status`: archiving clears a saturated
  board without losing whether the work was finished or abandoned, which an
  `ARCHIVED` status would have destroyed.

Columns added after the initial schema are listed in `ADDED_COLUMNS` in
`lib/db/client.ts` and applied with `ALTER TABLE` on boot, because
`CREATE TABLE IF NOT EXISTS` leaves an existing table untouched and the Hartask
database holds project state that must not be discarded to pick up a change.
The mechanism is additive only; anything that rewrites or drops data needs a
real versioned migration.

`hartask.config.json` is written by the settings page and is git-ignored by
default, the same way the database is: it holds one installation's preferences.
A project that wants to share settings across a team — once the harness scanner
gives `harnessScan.paths` a meaning — can un-ignore it.

The SQLite file should normally live at:

```text
hartask/data/hartask.sqlite
```

and should be ignored by Git by default unless a project explicitly decides otherwise.

---

# Single-process / single-port architecture

Hartask V1 deliberately avoids separate frontend and backend processes.

The starter uses Next.js full-stack so one process can serve the UI and server routes.

Default, and a setting rather than a constant — `port` in `hartask.config.json`,
or `HARTASK_PORT`, decided by `scripts/serve.mjs` before Next binds it, which is
what lets several projects run their own board at once:

```text
PORT 43127
```

Conceptually:

```text
43127
│
├── /             UI
├── /api/*        application endpoints
├── /mcp          MCP endpoint
└── /health       healthcheck
```

MCP is served at `/mcp`, with `/api/mcp` mounting the same server, both on the same Next.js process and port.

The project should continue to avoid requiring a second port unless a future feature makes it unavoidable.

---

# Intended architecture

```text
                           PROJECT
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
      CODE                 HARNESS                HARTASK
                              │                      │
                 AGENTS / Skills / Hooks             │
                              │                      │
                              └──────────┐           │
                                         ↓          │
                                  Coding Agent      │
                              Claude/Codex/Cursor    │
                                         │          │
                                         ↓          │
                                   Hartask MCP ─────┘
                                         │
                               ┌─────────┼─────────┐
                               ↓         ↓         ↓
                           Context     Tools     Resources
                               │         │         │
                               └────┬────┴─────────┘
                                    ↓
                              Hartask Core
                                    │
                    ┌───────────────┼───────────────┐
                    ↓               ↓               ↓
                  Tasks         Prompt Stack     Harness
                    │               │               │
                    ↓               ↓               ↓
                 Events           Runs          Scanner
                    │               │               │
                    └───────────────┼───────────────┘
                                    ↓
                             hartask.sqlite

USER
 │
 ↓
http://localhost:43127
 │
 ↓
Hartask Web UI
```

---

# Current starter structure

```text
hartask/
├── app/
│   ├── api/
│   │   ├── context/
│   │   ├── handoff/
│   │   ├── harness/
│   │   ├── health/
│   │   ├── mcp/
│   │   ├── prompts/
│   │   └── tasks/
│   ├── harness/
│   ├── summary/
│   ├── prompts/
│   ├── settings/
│   ├── tasks/
│   │   └── [id]/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   └── nav.tsx
├── data/
├── docs/
│   ├── AGENT-SKILLS.md
│   ├── FIRST-RUN.md
│   ├── INSTALL-PROMPT.md
│   ├── NEXT-STEPS.md
│   └── SYNC.md
├── lib/
│   ├── mcp/
│   │   ├── handler.ts
│   │   ├── server.ts
│   │   ├── tools.ts
│   │   └── transport.ts
│   ├── db/
│   │   ├── client.ts
│   │   └── schema.sql
│   ├── hartask/
│   │   ├── harness/
│   │   │   └── scanner.ts
│   │   ├── repositories/
│   │   │   ├── handoff.ts
│   │   │   ├── projects.ts
│   │   │   └── tasks.ts
│   │   ├── config.ts
│   │   ├── contract.ts
│   │   └── types.ts
│   └── mcp/
│       └── tools.ts
├── scripts/
│   ├── dev/
│   │   └── load-roadmap.mjs
│   ├── init-db.mjs
│   └── seed.mjs
├── tests/
│   ├── handoff.repository.test.ts
│   ├── onboarding.test.ts
│   ├── settings.test.ts
│   ├── helpers.ts
│   ├── setup.ts
│   └── tasks.repository.test.ts
├── AGENTS.bootstrap.example.md
├── hartask.config.example.json
├── next.config.mjs
├── package.json
└── README.md
```

---

# Getting started

From inside the extracted `hartask` folder:

```bash
npm install
npm run db:init
npm run db:seed   # optional: sample tasks
npm run dev
```

Then open:

```text
http://localhost:43127
```

Health check:

```text
http://localhost:43127/api/health
```

The Tasks view is backed by SQLite: it reads the task tree from the database and
writes through server actions. Summary and Harness are still static placeholders.

`npm run db:seed` loads a small sample hierarchy and is skipped if the database
already contains tasks. The database is created automatically on first request,
so `db:init` is only needed if you want the file to exist up front.

---

# What is implemented in this starter

Working end to end:

- Next.js/TypeScript project skeleton;
- one-process / one-port development configuration;
- SQLite connection layer (`lib/db/client.ts`) with WAL, foreign keys and
  automatic schema bootstrap;
- config loader for `hartask.config.json`, with environment overrides
  (`HARTASK_CONFIG`, `HARTASK_DATABASE`, `HARTASK_PROJECT_NAME`,
  `HARTASK_ARCHIVE_REMINDER_THRESHOLD`) taking precedence, so a single run can
  be redirected without editing the file;
- settings page at `/settings` writing that file, saying when an environment
  variable is overriding a value, plus `GET/PATCH /api/settings`. Everything
  there takes effect immediately except the port, which is chosen before the
  server starts and says so. The sync token is never read back —
  not by the page, not by the API, and not through the override notice: every
  path answers `configurado` or `sin configurar`;
- task repository: list, hierarchy tree, get, create, update, status
  transitions, notes and events;
- project repository (single project row, created on first run);
- handoff repository over `project_handoff`, append-only so every checkpoint is
  kept and the current handoff is simply the latest row;
- Tasks view backed by SQLite: collapsed cards ordered by status (READY first,
  DONE last), hierarchy, per-status counts, create/update forms and a
  recent-events panel;
- archiving for root tasks in DONE or BACKLOG, cascading to their subtasks and
  reversible from an "Archivadas" section, with a reminder and a bulk
  "archive all" once archivable work passes a configurable threshold, plus an
  opt-in that does it without being asked. The bulk archive asks which statuses
  it should take — DONE is offered checked and BACKLOG is not, because finished
  work is tidying up and unstarted work is a decision — through a modal built on
  the native `popover` attribute, so the confirmation costs no client
  JavaScript;
- Summary view backed by SQLite: editable Project Context plus the last
  handoff, answering the cold-start questions;
- Mermaid diagrams: Summary draws any ```mermaid block in the Project Context,
  and Harness draws itself from the scan, so that picture cannot drift from
  what is on disk;
- optional categories: a free-text label grouping tasks by area, with the board
  filterable to one of them from the URL. Nullable on purpose — a task without a
  category is normal, not incomplete — and a name that already exists under a
  different case reuses that spelling, so a board does not grow "Sync", "sync"
  and "SYNC" as three areas. A subtask takes its parent's category when none is
  given, because a subtask born blank drops out of its own area's filter and the
  parent then shows with none of the work under it; saying nothing and saying
  "none" stay different answers, so an explicit null still opts out;
- task detail at `/tasks/[id]`: the task's own notes and its complete event
  timeline, which the board cannot show because it only lists the last events
  across the project;
- `GET/POST /api/tasks` and `GET/PATCH /api/tasks/[id]` (accepts `TASK-001` or a
  numeric id) with request validation;
- MCP over Streamable HTTP at `/mcp`: 15 semantic tools over the repositories
  and nine `hartask://` resources, one of them a template that lists the shared
  contexts it can serve;
- shared contexts, surfaced rather than stored and forgotten: the index rides in
  every `GET /api/context` briefing — slug, title, purpose, never bodies — and
  `GET /api/contexts/<slug>` or `hartask://contexts/<slug>` opens one. An agent
  that had to already know a document existed in order to find it would never
  read one, which is how a collection like this becomes write-only;
- harness scanner: reads the project's instructions, skills, agents, commands,
  hooks and MCP servers off disk, pulling declared servers and hook events out
  of the settings files that declare them. It stores path, scope and a content
  hash, never the content — the files stay the only copy of themselves — and
  the rows do not sync, because they describe one machine's disk;
- Prompt Stack: a queue of agent-executable instructions with an atomic claim,
  runs kept as rows so an instruction that needed three attempts still shows
  all three, and a `/prompts` view. `POST /api/prompts/claim` is the operation
  the whole queue exists for: two agents never receive the same prompt;
- `GET/POST /api/handoff` accepting the checkpoint payload documented above;
- bidirectional sync, either against a passive libSQL/Turso database or against
  another Hartask instance: every synced row carries a uuid, its origin and a
  Lamport counter, conflicts resolve last-write-wins per row and the discarded
  version is written to the task's history rather than dropped. The merge always
  runs locally. Remote rows are scoped by `project_uuid`, so one store can hold
  several projects. See `docs/SYNC.md`;
- `GET /api/context` returning real project, current task, counts, events and
  the current handoff — the cold-start briefing an agent reads;
- database initialization and seed scripts;
- first-run onboarding: `GET /api/context` returns set-up instructions while
  the project has no tasks and no handoff, so an agent adopting Hartask
  discovers `docs/FIRST-RUN.md` through the call it was already making;
- 83 tests on vitest, each file against its own temporary database and config
  file; the libSQL adapter is exercised through a `file:` URL, which is the
  same code path Turso takes.

Documentation and design:

- Harness view skeleton (static placeholder);
- Hartask Agent Contract;

- example project bootstrap instructions;
- implementation roadmap.

---

# Deliberately not implemented yet

The starter intentionally leaves these as the next development phase:

- cascade/grid switch;
- user-level skill discovery;
- generated agent adapters;
- filesystem watching;
- git metadata enrichment;
- lifecycle hook integrations;
- tests for the API routes and the UI (the repository layer is covered).

Hartask V1 should **not** initially add:

- multi-user accounts;
- Redis;
- PostgreSQL;
- vector databases/RAG;
- embedded LLM providers;
- autonomous code editing;
- automatic git push;
- a heavy workflow/orchestration engine.

The coding agent remains the orchestrator. Hartask provides state, continuity, methodology, queueing and visibility.

---

# Recommended next implementation order

See `docs/NEXT-STEPS.md`.

The shortest useful path is:

```text
SQLite repository
      ↓
Tasks UI
      ↓
Summary/Handoff
      ↓
Prompt Stack
      ↓
Prompt Runs
      ↓
MCP tools
      ↓
Harness scanner
```

This sequence makes Hartask useful to the human early, then useful to the agent, without prematurely building a large agent framework.

---

# Design principles

1. **Local-first, with optional peers** — Hartask belongs to one project and
   runs locally. Its database is the source of truth and it works with no
   network at all. Since bidirectional sync was added it can also exchange
   state with another Hartask instance, so a board can be read and added to
   from somewhere other than the project's machine. Sync is off unless a URL
   and a shared secret are configured.
2. **Single server** — one process and one five-digit port where practical.
3. **SQLite-first** — no external persistence required.
4. **Human and agent share state** — UI and MCP operate over the same core.
5. **Agent-maintained continuity** — the agent should update context/handoff as part of normal work.
6. **Semantic tools** — expose `complete_task`, not generic SQL access.
7. **Small bootstrap** — AGENTS.md should point to Hartask rather than duplicate Hartask.
8. **Source-of-truth separation** — Hartask observes harness files; it does not replace them.
9. **Meaningful events, not noise** — do not log every insignificant operation.
10. **Simple V1, expandable architecture** — no unnecessary orchestration infrastructure.

---

# Future direction

Hartask may later grow into a more capable local project control plane while retaining the same core model.

Potential expansions:

- task dependency graphs;
- Prompt Chains;
- multiple simultaneous coding agents;
- richer run history;
- generated harness diagrams;
- automatic project-context synthesis;
- agent-specific bootstrap/adapters;
- hook-backed session checkpoints;
- git/CI integration;
- lightweight observability;
- task/run diff inspection;
- explicit decision log;
- project snapshots/checkpoints.

The important constraint is that these features should build on the existing concepts rather than turn Hartask into a separate heavyweight agent platform.
