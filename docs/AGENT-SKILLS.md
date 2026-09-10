# Hartask Agent Skills — proposed V1

Hartask should work without these skills if MCP instructions/tools are available. Skills are workflow enhancers, not the source of truth.

That is not a style preference, it is the constraint these have to be written
under: a skill only runs if the host supports skills. Anything stated only here
works in Claude Code and fails silently in Codex or Cursor. So every rule below
also lives somewhere a host cannot skip — `AGENTS.md`, the bootstrap an adopting
project copies, the agent contract `/mcp` serves, or the description of the tool
itself. A skill makes a workflow smoother; it never carries a rule alone.

## hartask-project-context
Use when starting substantial work or recovering project context.
Flow: `hartask_start_session` -> inspect current task/handoff -> fetch only additional context that is relevant.

## hartask-task-workflow
Use when creating, claiming, progressing, blocking, reviewing or completing a task.
Canonical states: BACKLOG -> READY -> IN_PROGRESS -> REVIEW -> DONE, with BLOCKED/CANCELLED as side states.
Record meaningful task events, not every file write.

## hartask-prompt-runner
Use when the user says things like “take the next prompt”, “continue the queue”, or equivalent.
Flow: claim next prompt atomically -> create run -> execute -> record meaningful events -> complete/fail run -> update handoff.

## hartask-session-handoff
Use after meaningful changes and before ending a work session.
Update: what was done, current state, next step, known problems, important files and important decisions.

## hartask-shared-context
Use when something was worked out that would otherwise be derived again next
session: how a part of the system works and why, what was decided and
discarded, what is actually verified.

The skill's job is the judgment, not the call. Before writing, read the index
that `hartask_get_context` already returns and correct an existing document
rather than adding a second one on the same subject. Then place it:

- what the project **is** -> Project Context, which stays short enough to read in a minute
- how a **part** works and why -> a shared context
- where you **left off** -> a handoff
- what you found doing **this task** -> a note on that task
- anything that must travel with a clone of the repo -> the repo, not Hartask

Would it be stale in a week? Then it is a handoff or a note. Set `valid_as_of`
to the task it was last true as of: a document that admits its age is worth more
than one that quietly claims to be current.

Full reasoning in `docs/WHERE-IT-GOES.md`.

## hartask-harness-inspector
Use when the user asks what instructions, skills, hooks, agents, MCP servers, tools or guardrails apply to the project.
Hartask should scan the project filesystem and distinguish detected facts from inferred behavior.
