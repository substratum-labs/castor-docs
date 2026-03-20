---
sidebar_position: 3
---

# Preemptive Scheduling

Castor provides true preemptive scheduling: the kernel can interrupt an agent at any point, not just at syscall boundaries. This document explains the mechanism and why checkpoint/replay makes it work.

## The Insight

In a traditional OS, preemption is hard because you must save arbitrary state (registers, stack, heap). In Castor's checkpoint/replay model, the `syscall_log` already captures all externally-visible state. Everything between two syscalls is pure recomputable work.

Therefore: **cancel the agent at any point, resume from the last checkpoint, lose nothing.**

## Mechanism

Castor leverages Python's async task cancellation to inject interrupts at `await` points. Since LLM agents are I/O-bound (streaming inference, network calls), `await` points occur frequently, giving effective **token-level preemption granularity** without any special mechanism.

The fast/slow path separation ensures safety: destructive tools suspend before execution (can't be double-executed), and safe tools are idempotent (re-execution on replay is harmless).

## Preemption Triggers

| Trigger | Example |
|---|---|
| Human abort | User hits "stop" button |
| Budget exhaustion | Capability depleted mid-run |
| Deadline exceeded | Wall-clock timeout |
| Priority scheduling | Higher-priority agent needs resources |
| Policy violation | Content filter, safety check |

All triggers are kernel-side decisions. The agent never sees them.

## Preemption Context

When an agent is preempted, the kernel can attach context to the checkpoint:

- **`preemption_reason`:** why it was interrupted (e.g., `"HUMAN_ABORT"`, `"BUDGET_EXHAUSTED"`)
- **`preemption_payload`:** structured data from the interrupter
- **`partial_work`:** mid-thought LLM output captured before interruption

This context is **not** part of the `syscall_log`; it doesn't affect replay determinism. It's injected after replay catches up, as new context for the agent's next action. The agent can adapt its plan without any special handling in agent code.

Preemption is fully transparent to agent code. The agent has no idea it can be preempted; no error handling, hooks, or registration required.

## Further Reading

- [Checkpoint/Replay](./checkpoint-replay): the execution model that makes preemption possible
- [Whitepaper Section 6](../whitepaper/#6-preemptive-scheduling): formal treatment
