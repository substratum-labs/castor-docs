---
sidebar_position: 2
---

# Multi-Agent Orchestration

Castor supports spawning child agents with budget delegation, both synchronous (blocking) and asynchronous (fan-out/fan-in).

## Two API Styles

Multi-agent works with both the proxy API and `castor.lib`:

**castor.lib (recommended):**

```python
from castor import castor_agent
from castor.lib import tool, spawn, join

@castor_agent(name="researcher")
async def researcher() -> dict:
    results = await tool("web_search", query="climate data")
    return {"findings": results}

async def coordinator() -> str:
    handle = await spawn("researcher", capabilities={"api": 20.0})
    result = await join(handle)
    return f"Research complete: {result['findings']}"
```

**SyscallProxy (classic):**

```python
from castor import castor_agent, SyscallProxy

@castor_agent
async def researcher(proxy: SyscallProxy) -> dict:
    results = await proxy.web_search(query="climate data")
    return {"findings": results}

async def coordinator(proxy: SyscallProxy) -> str:
    result = await proxy.syscall("spawn_agent",
        agent_name="researcher",
        budgets={"api": 20.0})
    return f"Research complete: {result['findings']}"
```

The child gets its own `AgentCheckpoint` with its own `syscall_log`. The parent's budget is atomically reduced by the delegated amount. On completion, unused child budget is reclaimed.

## Asynchronous Fan-Out/Fan-In

For parallel work, spawn multiple children asynchronously and join later:

```python
from castor.lib import spawn, join

async def parallel_coordinator() -> str:
    # Fan-out: spawn multiple children
    handle_a = await spawn("researcher", capabilities={"api": 20.0})
    handle_b = await spawn("researcher", capabilities={"api": 20.0})

    # Fan-in: join results
    result_a = await join(handle_a)
    result_b = await join(handle_b)

    return f"Climate: {result_a}, Economy: {result_b}"
```

### Deterministic Child PIDs

Child PIDs are deterministic: `parent_pid::agent_name-N` (where N is the spawn sequence number). This ensures replay produces the same PID assignments.

## Budget Delegation

Budget delegation is atomic:

1. **Validate.** Check parent has enough for all delegated capabilities.
2. **Commit.** Deduct from parent, assign to child.
3. **Reclaim.** On child completion, unused budget returns to parent.

If delegation validation fails, the entire spawn is rejected; no partial deductions.

## Child HITL Propagation

If a child agent hits a HITL-required tool, the suspension propagates to the parent. The parent stores the child's checkpoint in its own syscall record, then suspends itself. On approval, the entire chain resumes via replay.

## Further Reading

- [castor.lib Guide](./castor-lib): the `supervisor()` pattern for LLM-driven delegation
- [Core Concepts](../getting-started/concepts): budget delegation overview
- [Budget Management](./budget-management): detailed budget patterns
