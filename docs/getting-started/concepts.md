---
sidebar_position: 3
---

# Core Concepts

## The Syscall Model

In Castor, LLM agents cannot directly access external resources. Every side effect (tool calls, LLM inference, file operations) goes through the **SyscallProxy**, which validates, budgets, and logs each request.

```python
async def my_agent(proxy: SyscallProxy) -> str:
    # Every external action is a syscall
    data = await proxy.syscall("search", query="climate data")
    report = await proxy.syscall("summarize", text=data)
    await proxy.syscall("send_email", to="boss", body=report)
    return "done"
```

The proxy also supports dynamic attribute access as a shorthand:

```python
# These are equivalent:
data = await proxy.syscall("search", query="climate data")
data = await proxy.search(query="climate data")
```

### The 9-Step Syscall Pipeline

Every `proxy.syscall()` call passes through a deterministic pipeline:

1. **Replay check:** if we're replaying, return the cached response
2. **Kernel tool check:** skip special kernel tools during replay
3. **Tool resolution:** look up the tool in the Gate registry
4. **Schema validation:** validate arguments against the tool's Pydantic schema
5. **Capability check:** verify sufficient budget, deduct upfront
6. **HITL gate:** if the tool is destructive/requires_hitl, suspend for approval
7. **Execution:** call the actual tool function
8. **Response logging:** append the result to the syscall log
9. **Return:** hand the result back to the agent

If any step fails (validation error, budget exhausted), the agent receives structured feedback, not a crash.

## Capabilities (Budget Tokens)

Capabilities are depletable budget tokens. Each tool declares what capability it consumes and how much each invocation costs.

```python
@castor_tool(consumes="api", cost_per_use=1.0)
async def web_search(query: str) -> list[str]: ...

@castor_tool(consumes="disk", cost_per_use=5.0, destructive=True)
def delete_directory(path: str) -> int: ...
```

When running an agent, you specify the initial budget:

```python
cp = await kernel.run(agent, budgets={"api": 100.0, "disk": 20.0})
```

The kernel enforces a **deduct-before-execute** policy: budget is reserved before the tool runs. If the tool fails, the budget is refunded. If the budget is exhausted, the agent receives feedback like:

```
"Insufficient capability 'api': need 1.0, have 0.5 remaining."
```

The LLM can then adjust its plan. No crash, no exception.

### Budget Delegation

Parent agents can delegate portions of their budget to child agents:

```python
async def parent(proxy: SyscallProxy):
    child_result = await proxy.syscall(
        "spawn_agent",
        agent_name="researcher",
        budgets={"api": 20.0},  # delegate 20 from parent's pool
    )
```

Delegation is atomic: if the child fails, unused budget is reclaimed.

## Checkpoint / Replay

Castor's execution model is based on **checkpoint/replay**, not coroutine serialization.

### Why Not Pickle Coroutines?

Python asyncio coroutines hold C-level stack frames, event loop references, and closures over mutable state. You cannot `pickle.dumps()` a live coroutine. Castor solves this differently.

### How It Works

The agent's state is captured as a **syscall log**, an ordered list of completed syscall request/response pairs. This log is the agent's checkpoint.

- **Suspend:** When the kernel needs to pause the agent (HITL, preemption), it raises `SuspendInterrupt`. The coroutine is destroyed. The checkpoint (a Pydantic model) is persisted.
- **Resume:** The agent function is called again from the top. The proxy serves cached responses from the syscall log, fast-forwarding to the suspension point. Then execution continues live.

```
Suspend at syscall 3:
  log = [search_result, analyze_result]  <- saved

Resume:
  syscall("search")   -> cached (instant)
  syscall("analyze")  -> cached (instant)
  syscall("report")   -> live execution continues
```

### Determinism Guarantee

Given the same syscall log, the agent function produces the same sequence of syscall calls. This works because LLM agents make decisions via LLM calls, which are themselves syscalls. All non-determinism is captured in the log.

## Human-in-the-Loop (HITL)

Tools can be marked as requiring human approval:

```python
@castor_tool(consumes="disk", cost_per_use=1.0,
             destructive=True, requires_hitl=True)
def delete_files(paths: list[str]) -> int: ...
```

When the agent calls such a tool, the kernel suspends execution and presents the request to a human. The human has three options:

| Action | What happens |
|---|---|
| **Approve** | The tool executes with the original arguments. |
| **Reject** | The tool is NOT executed. The agent receives feedback explaining why, and can re-plan. |
| **Modify** | The original request is logged as `HITL_MODIFIED`. The agent receives feedback and re-plans with guidance. |

The kernel never mutates the agent's arguments; this would break replay determinism. Instead, modification provides natural language feedback that the LLM uses to re-plan.

## Preemption

Castor provides true preemptive scheduling via `asyncio.Task.cancel()`. The kernel can interrupt an agent at any `await` point, which includes every LLM streaming chunk boundary.

```
Agent timeline:
  ===syscall 1===  ===LLM streaming===  ===syscall 2===
       |           ^^^^^^^^^^^^^^^^           |
  checkpoint    every chunk = preemption   checkpoint
  consistent    point (~10-100ms)          consistent
```

On preemption, the checkpoint is consistent up to the last completed syscall. Resume uses the same replay mechanism as HITL suspension.

## The castor.lib API

Castor also provides `castor.lib`, a standard library for agent developers that eliminates the need for a proxy parameter:

```python
from castor.lib import tool, chat, budget

async def my_agent() -> str:
    data = await tool("search", query="climate data")
    report = await chat(f"Summarize: {data}")
    remaining = budget("api")
    return f"Done ({remaining} budget left): {report}"
```

Both styles (proxy and castor.lib) are fully supported. The proxy is set via a `ContextVar` at runtime; agent code has zero kernel imports.

See the [castor.lib Guide](../guides/castor-lib) for patterns like `react()`, `parallel()`, `supervisor()`, and more.

## Next Steps

- [Architecture Overview](../architecture/overview): how the four subsystems interact
- [castor.lib Guide](../guides/castor-lib): the agent developer standard library
- [HITL Patterns](../guides/hitl-patterns): real-world approval workflows
- [Budget Management](../guides/budget-management): delegation, reclamation, and limits
