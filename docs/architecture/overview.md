---
sidebar_position: 1
---

# Architecture Overview

Castor is a microkernel: it provides **minimum mechanism** for agent security while leaving **maximum freedom** for agent logic. The kernel controls side effects, not reasoning.

## System Layers

```
┌─────────────────────────────────────────────┐
│             Agent (User Space)              │
│  async def agent() -> str:  # castor.lib    │
├──────────────────┬──────────────────────────┤
│  SyscallProxy    │  The trust boundary      │
├──────────────────┴──────────────────────────┤
│             Kernel Space                    │
│  ┌──────────┐ ┌──────────┐ ┌────┐ ┌──────┐  │
│  │   Gate   │ │Scheduler │ │Cap │ │ MMU  │  │
│  │ validate │ │ replay   │ │budg│ │memory│  │
│  │ execute  │ │ HITL     │ │ et │ │evict │  │
│  └──────────┘ └──────────┘ └────┘ └──────┘  │
├─────────────────────────────────────────────┤
│    Persistence (SQLite via SQLAlchemy)      │
└─────────────────────────────────────────────┘
```

## The Four Subsystems

### Gate (Tool Registry & Validation)

The Gate (`SyscallGate`) is the tool registry. Every tool available to the LLM is registered here with:

- **Pydantic V2 schema.** Auto-generated from function signatures.
- **Capability declaration.** Which budget type the tool consumes.
- **Cost per use.** How much each invocation costs.
- **Risk flags.** `destructive` and `requires_hitl`.

When the LLM generates a tool call, the Gate:
1. Resolves the tool by name
2. Validates the JSON arguments against the Pydantic schema
3. On validation failure, generates structured feedback for LLM self-correction
4. On success, executes the tool function

```python
@castor_tool(consumes="api", cost_per_use=1.0)
async def web_search(query: str) -> list[str]:
    """Search the web."""
    return [f"Result for '{query}'"]
```

:::info API Reference
See the [Gate API docs](https://substratum-labs.github.io/castor/api/gate/) for `SyscallGate`, `castor_tool`, and `ToolRegistry`.
:::

### Scheduler (Checkpoint/Replay)

The Scheduler manages agent execution lifecycle. Agent state is captured as a replay journal (`syscall_log`), not serialized coroutine frames. This enables suspend/resume, crash recovery, and HITL without any special agent code.

:::info API Reference
See the [Scheduler API docs](https://substratum-labs.github.io/castor/api/proxy/) for `SyscallProxy` and [Runner docs](https://substratum-labs.github.io/castor/api/runner/) for `AgentRunner`.
:::

### Capability (Budget Manager)

The Capability Manager tracks token-bucket budgets:

- **Deduct-before-execute** with refund-on-failure.
- **Atomic delegation.** Parent-to-child budget transfer with validate-all-then-commit.
- **Graceful degradation.** Exhaustion returns structured feedback, not exceptions.

```python
# Parent delegates budget to child
await proxy.syscall("spawn_agent",
    agent_name="researcher",
    budgets={"api": 20.0})
# If child fails, unused budget is reclaimed to parent
```

:::info API Reference
See the [Capability API docs](https://substratum-labs.github.io/castor/api/capability/) for `CapabilityManager` and `Capability`.
:::

### MMU (Context Window Manager)

The MMU prevents context window overflow:

- **Token counting.** Monitors current prompt token usage.
- **Watermark threshold.** Triggers eviction when approaching the limit.
- **Pinned messages.** System prompts are never evicted.
- **FIFO eviction.** Oldest unpinned messages are removed first.
- **Semantic page-in.** `search_memory` tool retrieves evicted content via vector search.

The MMU routes eviction through the SyscallProxy (`sys_kernel_page_out`) for replay safety.

:::info API Reference
See the [MMU API docs](https://substratum-labs.github.io/castor/api/mmu/) for `MMU` and `SemanticMemoryDriver`.
:::

## Data Flow

Every tool call passes through the SyscallProxy, which orchestrates the kernel subsystems: resolve the tool, validate arguments, check budget, gate destructive operations for HITL, execute, and log the result. If any step fails, the agent receives structured feedback it can use to adapt.

## Key Design Principles

1. **All side effects through syscalls.** The agent cannot bypass the proxy. This is the security boundary.

2. **Minimum mechanism in kernel.** The kernel validates, budgets, and gates. It never reasons, plans, or generates text.

3. **Deterministic replay.** Given the same syscall log, the agent produces the same execution trace. This enables suspend/resume, crash recovery, and HITL without coroutine serialization.

4. **Graceful degradation.** Budget exhaustion and validation errors produce LLM-readable feedback, not crashes. The agent can adapt its plan.

5. **Fast/slow path separation.** Safe operations execute instantly. Dangerous ones suspend for human review. No middle ground.

## Further Reading

- [Checkpoint/Replay](./checkpoint-replay): deep dive into the execution model
- [Preemption](./preemption): how `asyncio.Task.cancel()` enables true preemption
- [Capability Model](./capability-model): budget semantics and delegation
- [MMU Memory](./mmu): context window management
