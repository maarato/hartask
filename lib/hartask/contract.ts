/**
 * Canonical agent behavior for Hartask.
 *
 * HARTASK_AGENT_CONTRACT holds the durable rules of the methodology; they do
 * not change as the implementation advances. HARTASK_AVAILABLE_INTERFACE
 * states what an agent can actually call today, and must be updated whenever
 * an endpoint stops being a stub — an agent that is told about a capability
 * that does not exist fails on its first call.
 */

export const HARTASK_AGENT_CONTRACT = `
You are connected to Hartask for the current project.
Hartask manages project continuity: tasks, task events, notes, prompt stack, prompt runs, project handoff, summary and harness metadata.

Rules:
1. Before substantial work, obtain Hartask context when relevant.
2. Claim queued tasks/prompts before executing them.
3. Record meaningful progress, blockers, failures and completions as events.
4. Update the project handoff after meaningful work and before ending a work session.
5. Never access hartask.sqlite directly. Use Hartask tools/API.
6. Keep Project Context concise and stable; keep Last Context current and actionable.
`;

export const HARTASK_AVAILABLE_INTERFACE = `
Available today over HTTP on this same server:

  GET   /api/context               cold-start briefing: project context, current
                                   task, status counts, recent events, current handoff
  GET   /api/tasks                 list and hierarchy
  POST  /api/tasks                 { title, status, next_action, parent_id, agent_id }
  GET   /api/tasks/{id}            one task with its notes and events (TASK-001 or numeric id)
  PATCH /api/tasks/{id}            { status, next_action, blocked_reason, note, agent_id }
  GET   /api/handoff               current handoff (?history=true for previous checkpoints)
  POST  /api/handoff               { current_task, done, current_state, next, problems,
                                     important_files, important_decisions, agent_run_id }
  GET   /api/health

Status transitions record events automatically; do not log them separately.

Not implemented yet: /api/prompts and /api/harness are stubs, and this /api/mcp
route is a placeholder rather than an MCP transport. There is no prompt queue to
claim from, so rule 2 above currently applies to tasks only.
`;

/**
 * Returned by /api/context while the project has no tasks and no handoff.
 *
 * An agent following the bootstrap already calls that endpoint before
 * substantial work, so a first run is discovered by the call it was going to
 * make anyway — no extra file it has to be told to read.
 */
export const HARTASK_FIRST_RUN = `
This project has just adopted Hartask: there are no tasks and no handoff yet.

Ask the user before doing either of these. Both change their project, and the
second occupies a port on their machine:

1. Whether to migrate an existing task list. Look for tasks.md, TODO.md or
   similar first, and name the actual file and item count in the question.
2. Whether to start Hartask, with 'npm run dev' inside the hartask folder.

There is no importer on purpose: task files vary too much for a parser to be
trusted, so you read the file and create the tasks through POST /api/tasks.
Checked items map to DONE and unchecked to BACKLOG; indentation becomes
hierarchy through parent_id. Do not invent tasks, do not edit or delete the
original file, and check GET /api/tasks first so nothing is migrated twice.

After migrating, ask which task is next and set it to READY: a board that is
all BACKLOG and DONE leaves current_task null, so the next cold start has
nothing to point at.

Finish the first run by writing the Project Context and a first checkpoint
through POST /api/handoff. Full instructions: hartask/docs/FIRST-RUN.md
`;
