# Hartask Agent Skills — proposed V1

Hartask should work without these skills if MCP instructions/tools are available. Skills are workflow enhancers, not the source of truth.

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

## hartask-harness-inspector
Use when the user asks what instructions, skills, hooks, agents, MCP servers, tools or guardrails apply to the project.
Hartask should scan the project filesystem and distinguish detected facts from inferred behavior.
