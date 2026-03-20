---
sidebar_position: 2
---

# Checkpoint / Replay

Castor's execution model is based on checkpoint/replay, not coroutine serialization. This document explains why, how it works, and what guarantees it provides.

## The Problem

Castor needs to suspend agent execution (for HITL approval, preemption, or resource limits) and resume later, potentially hours or days later, possibly in a different process.

The original design proposed "serializing the coroutine state." **This is impossible in Python.** `asyncio` coroutines hold:

- C-level stack frames (not accessible from Python)
- References to the event loop (process-specific)
- Closures over mutable state
- File handles, network connections, and other non-serializable resources

You cannot `pickle.dumps()` a live coroutine.

## The Approach

Agent functions are plain `async def` functions. The kernel records a log of completed syscalls. On resume, it replays the function from the top, serving cached responses for already-completed syscalls and executing live from the point where it left off.

```python
async def research_agent(proxy: SyscallProxy) -> str:
    results = await proxy.syscall("web_search", query="topic")
    analysis = await proxy.syscall("llm_call", prompt=f"analyze {results}")
    await proxy.syscall("send_email", body=analysis)
    return "done"
```

The agent reads naturally: top to bottom, no phases, no state management. The agent has no idea it can be suspended and resumed.

## Determinism Guarantee

**LLM agent functions are naturally deterministic between syscalls.** Given the same tool responses, the agent makes the same decisions, because the LLM calls are themselves syscalls captured in the log. All external interactions must go through the proxy to preserve this guarantee.

## Further Reading

- [Preemption](./preemption): how checkpoint/replay gives preemption "for free"
- [HITL Patterns](../guides/hitl-patterns): approve, reject, and modify workflows
- [Whitepaper Section 4](../whitepaper/#4-checkpointreplay-determinism): formal treatment
