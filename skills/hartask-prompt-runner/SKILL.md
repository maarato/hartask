---
name: hartask-prompt-runner
description: Use when the user says to take the next queued prompt, continue the queue, or work through what is waiting in a project that has Hartask.
---

# Working the queue

```
hartask_claim_next_prompt  { agent_id }      takes one, atomically
hartask_complete_prompt    { id, summary }   when it worked
hartask_fail_prompt        { id, error }     when it did not
```

## Claim it, never read it and run it

The briefing names the prompt a claim would take. That is so you know what is
waiting, not so you can start on it: two agents calling claim never receive the
same prompt, and that guarantee only holds for work that was claimed.

Reading the queue and acting on what you saw is the one mistake this design
exists to prevent.

That guarantee covers agents sharing one database. Across machines that sync it
cannot hold, and a double claim is recorded rather than prevented — if you see a
`SYNC_DOUBLE_CLAIM` event, two agents already ran the same instruction and the
question is what to do about the result, not how to stop it.

## Failing is normal

`hartask_fail_prompt` returns the prompt to the queue by default and keeps the
attempt, because the same instruction often needs several tries. Pass
`retry: false` only when retrying cannot help — the instruction is wrong, not
the attempt.

Say what actually went wrong in `error`. Every attempt is kept as a row, so a
prompt that took three tries shows all three, and the next agent reads why the
first two failed instead of repeating them.

## Finishing

`summary` on completion is what the user reads to know it was done — what
changed, not that it succeeded.

Then write a checkpoint: the queue records that a prompt ran, and the checkpoint
records where the project stands afterwards. See `hartask-session-handoff`.
