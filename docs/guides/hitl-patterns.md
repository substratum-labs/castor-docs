---
sidebar_position: 1
---

# HITL Patterns

Human-in-the-loop (HITL) is Castor's mechanism for giving humans control over destructive agent operations. This guide covers the three HITL actions and practical patterns for using them.

## Marking Tools for HITL

Any tool can require human approval by setting `requires_hitl=True`:

```python
@castor_tool(consumes="disk", cost_per_use=1.0,
             destructive=True, requires_hitl=True)
def delete_files(paths: list[str]) -> int:
    """Delete files. Requires human approval."""
    return len(paths)
```

You can also set `destructive=True` without `requires_hitl=True`. This marks the tool as dangerous but allows it to execute if the budget permits. The combination of both flags is the strictest: always suspend, always ask.

## The Suspend/Resume Cycle

When an agent calls a HITL-required tool:

1. The kernel raises `SuspendInterrupt`; the coroutine is destroyed
2. The checkpoint is saved with `status = "SUSPENDED"` and the pending request
3. A human reviews the pending request
4. The human approves, rejects, or modifies
5. The agent is resumed via checkpoint/replay

```python
# Run the agent (it will suspend at delete_files)
cp = await kernel.run(agent, budgets={"disk": 10.0})

# Inspect the pending request
print(cp.pending_tool)   # "delete_files"
print(cp.pending_args)   # {"paths": ["/tmp/old.log"]}

# Choose an action...
```

## Approve

Approve executes the tool with the original arguments:

```python
await kernel.approve(cp)
cp = await kernel.run(agent, checkpoint=cp)
# Agent resumes, delete_files executes, agent continues
```

## Reject

Reject does NOT execute the tool. The agent receives feedback and can re-plan:

```python
await kernel.reject(cp, reason="Don't delete logs; we need them for auditing.")
cp = await kernel.run(agent, checkpoint=cp)
# Agent sees: "HITL_REJECTED: Don't delete logs; we need them for auditing."
# The LLM re-plans without the delete
```

## Modify

Modify provides guidance without directly changing the arguments. The original request is logged as `HITL_MODIFIED`, and the agent re-plans:

```python
await kernel.modify(cp, feedback="Only delete files older than 30 days.")
cp = await kernel.run(agent, checkpoint=cp)
# Agent sees: "HITL_MODIFIED: Only delete files older than 30 days."
# The LLM re-plans, perhaps calling delete_files with a filtered list
```

:::caution Why not mutate arguments?
Castor never directly modifies the agent's pending arguments. Doing so would break replay determinism, since the syscall log must match the agent's actual execution trace. Instead, the LLM receives feedback and makes a new decision, which is logged as a fresh syscall.
:::

## Child Agent HITL Propagation

When a child agent encounters a HITL-required tool, the suspension propagates up to the parent:

```
Parent agent runs
  -> spawns child agent
    -> child calls destructive tool
    -> child suspends (SuspendInterrupt)
  -> parent records child's checkpoint
  -> parent suspends too

Human approves child's pending request
  -> kernel resumes parent
    -> parent replays, reaches spawn point
    -> child resumes via replay, tool executes
    -> child completes
  -> parent continues with child's result
```

## CLI Support

The Castor CLI supports reject and modify for persisted checkpoints:

```bash
castor ps --store demo.db              # List all checkpoints
castor inspect <pid> --store demo.db   # Show checkpoint details
castor reject <pid> --reason "..."     # Reject pending HITL
castor modify <pid> --feedback "..."   # Modify pending HITL
```

Note: The CLI cannot **approve** because approval requires the Gate runtime (to actually execute the tool). Approval must happen through the Python API or via `castor run --hitl interactive`.

## Further Reading

- [Core Concepts](../getting-started/concepts): HITL overview
- [Checkpoint/Replay](../architecture/checkpoint-replay): how suspension and replay work
