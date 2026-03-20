---
slug: why-os-kernel
title: "Why an OS Kernel for AI Agents?"
authors: [substratum-labs]
tags: [architecture, deep-dive]
---

Every AI agent framework has guardrails. Rate limiters, content filters, approval hooks. So why build a kernel?

Because guardrails are bolted on top of an execution model that has no concept of trust boundaries. A kernel puts the trust boundary into the execution model itself. Policy says "this agent shouldn't do that." Mechanism makes it so the agent *can't*. Operating systems learned this distinction decades ago.

<!-- truncate -->

## The Wrong Abstractions

Most agent safety solutions today fall into three categories:

- **Prompt engineering.** "You must never delete production data." Works until the instruction gets evicted from the context window.
- **Policy engines.** Rule-based filters that check tool calls against allow/deny lists. Binary: either the agent can use a tool or it can't. An agent "allowed to search" that makes 10,000 requests is as dangerous as one that's denied.
- **Approval queues.** Every tool call gets routed to a human. The human approves everything after the first twenty, because they have to.

These approaches share a flaw: they bolt safety onto the outside of an execution model that has no concept of trust boundaries. The LLM and the tools live in the same undifferentiated space. There is no kernel.

## Capabilities: From Unforgeable Tokens to Depletable Budgets

In 1966, Dennis and Van Horn introduced the capability model: an unforgeable token that grants the holder access to a specific resource. A process doesn't ask "am I allowed to read this file?" It presents a capability token that proves it can. No token, no access. The token can't be forged, and it can't be escalated.

This is elegant, but it has a limitation for LLM agents: **binary access is insufficient.** An agent with a "search" capability that makes unlimited searches is indistinguishable from one with no capability control at all.

Castor extends capabilities with **depletable budgets**:

```python
@castor_tool(consumes="api", cost_per_use=1.0)
async def web_search(query: str) -> list[str]: ...
```

The agent receives a budget at creation: `{"api": 100.0}`. Each tool call deducts from the budget. When it's exhausted, the agent gets structured feedback and adjusts its plan:

```
"Insufficient capability 'api': need 1.0, have 0.5 remaining."
```

Budget enforcement is **deduct-before-execute**: the cost is reserved before the tool runs, and refunded only on failure. This prevents overcommitment even under concurrent execution.

### Why "By Construction" Matters

The critical distinction: budgets are enforced by the execution model, not by configuration. There is no "admin mode" that bypasses them. There is no flag to set. The kernel cannot execute a tool without deducting the budget. The code path doesn't exist.

Compare this with ACL-based approaches where a misconfigured policy silently grants too much access. With capabilities, the worst case is a budget that's too large, which is visible, auditable, and bounded.

### Delegation Without Escalation

When a parent agent spawns a child, it delegates a portion of its budget:

1. **Validate all.** Parent has enough for every delegated capability.
2. **Commit all.** Atomically deduct from parent, assign to child.
3. **Reclaim on completion.** Unused child budget returns to parent.

The conservation invariant holds: `delegate(amount) + reclaim(unused) = amount`. No budget is created or destroyed. A child can never spend more than what its parent explicitly gave it.

---

## Checkpoint/Replay: The Art of Not Serializing Coroutines

Castor needs to suspend an agent (for human approval, crash recovery, or preemption) and resume it later. Possibly hours later, possibly in a different process. The naive approach: serialize the coroutine state.

**This is impossible in Python.** `asyncio` coroutines hold C-level stack frames, event loop references, closures over mutable state, and non-serializable resources (file handles, network connections). You cannot `pickle.dumps()` a running coroutine.

The alternative, converting agent functions into explicit state machines, is possible but impractical. An agent with 10 tool calls needs 10+ phases with manual state management. Conditional logic creates phase explosion. The agent author must know they're writing for a suspend/resume system.

### The Replay Insight

Castor takes a different path, inspired by Temporal.io and event sourcing: **don't save the state, save the decisions.**

Agent functions are plain `async def` functions. The kernel records every completed tool call in a replay journal (`syscall_log`). On resume, it runs the function from the top, serving cached responses for every syscall that already completed:

```
First run:
  syscall("search", ...)    → executes live, logs result
  syscall("analyze", ...)   → executes live, logs result
  syscall("delete", ...)    → destructive → SuspendInterrupt raised
  Checkpoint saved: log = [search_result, analyze_result]

Human approves.

Resume:
  syscall("search", ...)    → replay: return cached result (instant)
  syscall("analyze", ...)   → replay: return cached result (instant)
  syscall("delete", ...)    → past cache → execute live
  Agent completes.
```

The function runs twice. But the first two syscalls are served from cache: instant, deterministic, zero side effects.

### Why This Works: Natural Determinism

The key insight: **LLM agent functions are naturally deterministic between syscalls.** Given the same tool responses, the agent makes the same decisions. Why? Because the LLM inference calls are themselves syscalls, captured in the log.

The proxy verifies this at runtime: if the agent issues a different syscall than what's in the log, a `ReplayDivergenceError` fires, catching corruption or non-deterministic agent code immediately.

### One Mechanism, Four Capabilities

Checkpoint/replay isn't just for suspension. The same mechanism gives us:

- **Human-in-the-loop.** Destructive tool → suspend → human decides → resume.
- **Crash recovery.** Process dies → restart → replay from checkpoint.
- **Suspend/resume.** Long-running agent → save checkpoint → resume tomorrow.
- **Preemption.** Kernel cancels agent → save checkpoint → resume with new context.

No separate implementation for each. One replay journal, four use cases.

### Comparison with Prior Art

| System | Approach | Castor's Addition |
|---|---|---|
| **Temporal.io** | Activity/workflow event sourcing | Budgets + HITL + context MMU |
| **Azure Durable Functions** | Orchestrator replay | Not scoped to serverless; adds agent-specific primitives |
| **Event Sourcing** | State = replay of events | Runtime enforcement, not just a pattern |

Castor's `syscall_log` is structurally equivalent to Temporal's activity history, but purpose-built for LLM agents.

---

## Preemptive Scheduling: Token-Level Granularity

In a traditional OS, preemptive scheduling means the kernel can interrupt any process at any time. The process doesn't get a choice. Cooperative scheduling means the process must voluntarily yield. The history of operating systems is the story of why preemption won.

LLM agents face the same choice. An agent burning through API calls or spinning in a reasoning loop needs to be interruptible. Not "when it feels like yielding," but now.

### The `asyncio` Trick

`asyncio.Task.cancel()` injects a `CancelledError` at the next `await` point. For I/O-bound LLM agents, the time between `await` points is typically milliseconds.

The critical observation: **90%+ of wall-clock time in LLM agents is spent in streaming inference.** And streaming is an async iteration where every chunk boundary is an `await`:

```python
async for chunk in llm_stream(...):
    partial_response += chunk
    # CancelledError can be injected HERE, at every chunk
```

This gives us **token-level preemption granularity** (typically 10-100ms) without any special mechanism. Real LLM streaming APIs (aiohttp, httpx) have natural `await` points at every chunk. The kernel doesn't need to know about the LLM protocol. It just cancels the task.

### Why Checkpoint/Replay Makes Preemption Free

In a traditional OS, preemption requires saving arbitrary state: registers, stack, heap pointers. Complex and platform-specific.

In Castor's model, the `syscall_log` already captures all externally-visible state. Everything between two syscalls is pure, recomputable work. Cancel the agent at any point, resume from the last checkpoint, lose nothing.

The agent doesn't need preemption-aware code. No `try/except CancelledError`. No `asyncio.shield()`. The kernel cancels, the checkpoint is saved, and later the agent replays to the interruption point and continues.

The fast/slow path separation eliminates the need for shielded critical sections: destructive tools suspend **before** execution (can't be double-executed), and safe tools are idempotent or cached on replay. When preempted, the kernel attaches metadata (`preemption_reason`, `partial_work`) that gets injected after replay catches up, so the agent adapts naturally without special handling.

---

## MMU: When Context Windows Become Virtual Memory

LLMs have a finite context window. When it fills up, something has to go. Most frameworks handle this by silently truncating old messages. The agent loses context without knowing it, including, potentially, its own safety instructions.

Castor treats the context window as virtual memory:

| OS MMU | Castor MMU |
|---|---|
| Physical memory pages | Context window tokens |
| Page fault | Context overflow |
| LRU/FIFO eviction | FIFO eviction with pinning |
| Swap space | Semantic memory store |
| Pinned pages (kernel memory) | Pinned messages (system prompts) |

### Pinning

System prompts and critical instructions are **pinned**: they can never be evicted, no matter how full the context window gets. This directly prevents context amnesia. The agent's safety instructions survive indefinitely.

### Eviction

When the token count exceeds a configurable watermark (e.g., 85% of the window), the MMU evicts the oldest unpinned messages. Evicted content is stored in a semantic memory backend, not discarded.

Eviction is routed through the SyscallProxy as a kernel tool (`sys_kernel_page_out`). This means it's captured in the syscall log, which means it's replay-safe. The MMU doesn't need to know about replay. The proxy handles it.

### Semantic Page-In

Agents can retrieve evicted context via `search_memory`:

```python
memories = await proxy.search_memory(query="user's budget constraints")
```

This is demand paging for LLMs: when the agent needs information that was evicted, it fetches it from the semantic store. The `SemanticMemoryDriver` abstraction allows different backends, from substring search for testing to vector search for production.

### The Honest Limitation

Context paging is fundamentally lossy. Unlike real memory, evicted context is retrieved probabilistically via semantic search. If the agent needs an exact detail from an evicted message, retrieval may fail.

This is an inherent limitation of the LLM paradigm, not a bug in the implementation. Castor mitigates it with pinning (critical info never evicts) and conservative watermarks (eviction starts early), but it cannot eliminate it.

---

## Minimum Mechanism

In 1996, Jochen Liedtke published "Towards Real Microkernels": the argument that a kernel should contain the minimum mechanism needed to implement protection, and nothing more. Anything that can run in user space should.

Castor follows this principle. **The kernel controls side effects, not reasoning.** It doesn't know what the LLM is thinking. It doesn't parse the LLM's output. It doesn't manage the prompt. It only interposes at the syscall boundary: the moment the agent tries to affect the outside world.

This is why Castor can wrap any agent framework. It doesn't need to understand the framework's agent loop, its prompt format, or its tool calling convention. It only needs to sit between the tool call and the tool execution.

---

## Not New Ideas, Applied to a New Problem

None of this is novel computer science. Capabilities are from 1966. Checkpoint/replay is from event sourcing and Temporal. Preemption via task cancellation is standard asyncio. Virtual memory paging is OS 101.

What's new is the application domain. LLM agents that autonomously invoke tools are a fundamentally new class of "untrusted code with real-world side effects." The primitives that operating systems developed to handle this class of problem translate directly, and we believe correctly, to the agent setting.

The [whitepaper](/docs/whitepaper/) has the full formal treatment. The [quickstart](/docs/getting-started/quickstart) has the code.

---

*Castor is open source under Apache 2.0. [GitHub](https://github.com/substratum-labs/castor) · [PyPI](https://pypi.org/project/castor-kernel/)*
