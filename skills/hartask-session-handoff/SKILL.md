---
name: hartask-session-handoff
description: Use after meaningful work and before ending a session in a project that has Hartask — a checkpoint of where things stand, so the next session does not start from nothing.
---

# Leaving the work findable

```
hartask_update_handoff {
  current_task, done, current_state, next, problems,
  important_files, important_decisions
}
```

Each checkpoint is a new row; the most recent one is what a cold start reads.
Write one after meaningful progress, an important decision, a discovered blocker
or a completed task — not after every file write.

## The one field that matters most

`next` is the single line the next session reads first. Make it an action
someone can take, not a topic: *"TASK-075: the port is read by nothing; pick one
of the two exits the task describes"* rather than *"continue with the port"*.

If there is no obvious next step, say what the open question is. That is still
actionable — it tells the reader what to decide before doing anything.

## Being honest in `problems`

This is the field that decays fastest into decoration. What belongs there:

- what is broken and you did not fix
- what you verified by hand and has no test
- what you assumed and did not check

A checkpoint that says everything is fine, when a route has no tests and you
only clicked it once, teaches the next session to trust something nobody
verified. Say which it was.

## `important_decisions`

The decision *and why the alternative lost*. A decision without its rejected
option gets re-opened by the next person who sees the same fork, and they have
to walk the same path to reach the same answer.

If the reasoning is longer than a paragraph, or if it will still be true in a
month, it is not a checkpoint — it is a shared context. See
`hartask-shared-context`.

## After the checkpoint

If this project syncs, nothing you wrote has left the machine yet. Run
`hartask_sync` after the checkpoint, so the next session — here or on another
machine — reads it. Ask the user before the first sync on an instance: it sends
the whole board off their machine.
