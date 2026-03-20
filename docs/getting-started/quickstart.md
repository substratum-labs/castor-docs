---
sidebar_position: 2
---

# Quickstart

Build a guarded agent in under 5 minutes. This example demonstrates tool registration, budget enforcement, and human-in-the-loop approval.

## 1. Register Tools

Tools are regular Python functions decorated with `@castor_tool`. Each tool declares the capability it consumes and its cost per invocation.

```python
from castor import Castor, SyscallProxy, castor_tool

@castor_tool(consumes="api", cost_per_use=1.0)
async def web_search(query: str) -> list[str]:
    """Simulate a web search."""
    return [f"Result 1 for '{query}'", f"Result 2 for '{query}'"]

@castor_tool(
    consumes="disk",
    cost_per_use=1.0,
    destructive=True,
    requires_hitl=True,
)
def delete_files(paths: list[str]) -> int:
    """Delete files: destructive, requires human approval."""
    print(f"  [tool] Would delete: {paths}")
    return len(paths)
```

Key points:
- `consumes`: which budget capability this tool draws from
- `cost_per_use`: how much budget each invocation costs
- `destructive=True`: marks the tool as having irreversible side effects
- `requires_hitl=True`: the kernel will suspend for human approval before executing

## 2. Create the Kernel

```python
kernel = Castor(tools=[web_search, delete_files])
```

The `Castor` facade auto-configures the Gate (tool registry), Capability Manager, and Scheduler.

## 3. Define an Agent Function

Agent functions are plain `async def` functions. They receive a `SyscallProxy` and route all side effects through it.

```python
async def research_agent(proxy: SyscallProxy) -> str:
    """An agent that searches the web and cleans up temp files."""
    # Fast path: executes immediately, deducts from "api" budget
    results = await proxy.web_search(query="castor kernel")
    print(f"  [agent] Search returned: {results}")

    # Slow path: suspends for human approval (destructive + requires_hitl)
    deleted = await proxy.delete_files(paths=["/tmp/old.log"])
    return f"Done! Cleaned {deleted} files."
```

## 4. Run the Agent

```python
import asyncio

async def main():
    # First run: agent executes until HITL suspend
    print("=== Run 1: agent executes until HITL suspend ===")
    cp = await kernel.run(
        research_agent,
        budgets={"api": 10.0, "disk": 5.0},
        pid="quickstart-001",
    )
    print(f"  Suspended: {cp.is_suspended}")
    print(f"  Pending: {cp.pending_tool}({cp.pending_args})")

    # Human approves the destructive operation
    print("\n=== Human approves the delete ===")
    await kernel.approve(cp)

    # Resume: replays past syscalls, continues from suspension point
    print("\n=== Run 2: agent resumes after approval ===")
    cp = await kernel.run(research_agent, checkpoint=cp)
    print(f"  Status: {cp.status}")
    print(f"  Result: {cp.result}")

    # Budget check
    print("\n=== Budget usage ===")
    for name in cp.capabilities:
        used = cp.budget_used(name)
        remaining = cp.budget_remaining(name)
        print(f"  {name}: {used}/{used + remaining} used")

asyncio.run(main())
```

## What Happens Under the Hood

```
Run 1:
  proxy.web_search(...)     -> fast path: validate, deduct budget, execute, log
  proxy.delete_files(...)   -> slow path: destructive + HITL -> SuspendInterrupt
  Agent coroutine destroyed. Checkpoint saved with syscall_log = [web_search].

kernel.approve(cp):
  Marks pending_hitl as approved.

Run 2 (replay):
  proxy.web_search(...)     -> replay: return cached result (instant, no side effects)
  proxy.delete_files(...)   -> past cache -> HITL approved -> execute live -> log
  Agent returns "Done! Cleaned 1 files."
```

## Next Steps

- [Core Concepts](./concepts): understand the syscall model, capabilities, and replay
- [HITL Patterns](../guides/hitl-patterns): approve, reject, and modify workflows
- [Budget Management](../guides/budget-management): configure and delegate budgets
