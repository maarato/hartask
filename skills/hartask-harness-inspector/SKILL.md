---
name: hartask-harness-inspector
description: Use when asked what instructions, skills, subagents, commands, hooks, MCP servers or guardrails apply to this project — or when something an agent was expected to have is not behaving as expected.
---

# What is actually configured here

```
hartask_get_harness { rescan: true }    read the disk again
```

Reports what a scan found: instructions, skills, subagents, commands, hooks, MCP
servers and host settings, each with where it came from and which runtime reads
it.

## Say what was found, not what it means

The scan reports **facts on disk**. Whether a hook fires, whether a skill
triggers, whether the host actually loads a settings file — none of that is
observed, and asserting it is how a confident answer turns out to be wrong.

Separate the two when you answer:

- *"`.claude/settings.json` declares a `Stop` hook running `npm test`"* — found.
- *"tests run when you end a session"* — inferred, and worth marking as such.

## What it deliberately does not have

**The content.** Hartask stores a path, a scope and a hash, never the file
itself. Those files stay the only copy of themselves. If you need to know what
an instruction says, read the file.

**A definition of user-level configuration.** The scan covers the project. A
skill installed in the user's home directory applies to the agent and does not
appear here, so "not in the harness" does not mean "not active".

**Anything from another machine.** Harness rows describe one disk and do not
sync. A project's board reaching another machine says nothing about that
machine's harness.

## When something is missing

A stale scan is the usual cause: the scan runs when asked, not when a file
changes. Pass `rescan` before concluding that something is absent.

If it is genuinely absent, say so plainly rather than assuming the host has it
some other way — an agent told a skill exists, that does not, fails on the call.
