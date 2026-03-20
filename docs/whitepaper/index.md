---
sidebar_label: Whitepaper
title: "Castor: A Secure Microkernel for LLM Agents"
description: "Capability-based security, deterministic checkpoint/replay, and human-in-the-loop control for autonomous LLM agent systems"
---

# Castor: A Secure Microkernel for LLM Agents

**Authors:** Substratum Labs
**Version:** 1.0, March 2026

---

## Abstract

Large language model (LLM) agents that autonomously invoke external tools present a fundamental security challenge: the agent's decisions are driven by non-deterministic attention mechanisms, yet its actions (API calls, file deletions, financial transactions) have real consequences. Current agent frameworks (LangChain, CrewAI, AutoGen) provide no security boundary between the LLM and the outside world. We present Castor, a microkernel that interposes a deterministic execution engine between the LLM and external tools. Castor provides three guarantees in a single coherent system: (1) capability-based security with depletable budget tokens that prevent resource abuse by construction, (2) a checkpoint/replay execution model that enables suspend/resume, crash recovery, and human-in-the-loop control without coroutine serialization, and (3) true preemptive scheduling via asyncio task cancellation with token-level granularity. The Python prototype passes 378 tests, implements all core requirements, and demonstrates integration with seven major agent frameworks (smolagents, pydantic-ai, LangChain, CrewAI, OpenAI Agents, AutoGen, and Google ADK) as a guard layer.

---

## 1. Introduction

### 1.1 The Problem: Uncontrolled Autonomy

LLM agents execute tools (web searches, API calls, file operations, code execution) based on natural language reasoning. As these agents grow more capable and autonomous, they present three fundamental failure modes:

**Privilege abuse.** An agent with access to a file deletion tool may decide to "clean up" production data. Current frameworks provide no distinction between safe reads and destructive writes; if a tool is registered, the agent can call it without restriction.

**Resource exhaustion.** An agent asked to "research a topic thoroughly" may make thousands of API calls, burning through rate limits and credits. Without depletable budgets, the only guard against runaway resource consumption is hope.

**Context amnesia.** Long-running agents overflow their context window. When older messages are silently dropped, the agent may forget safety instructions, user preferences, or critical prior decisions.

These failure modes are not edge cases; they are the default behavior of autonomous agents in production. The question is not whether to add guardrails, but what primitives those guardrails should be built from.

### 1.2 The Operating System Analogy

We observe that the relationship between an LLM and external tools is structurally identical to the relationship between a user-space process and the operating system kernel:

| OS Concept | Castor Analog |
|---|---|
| User space (untrusted processes) | LLM agent functions |
| Kernel space (trusted supervisor) | Castor execution engine |
| System calls | Tool invocations via `proxy.syscall()` |
| Capabilities (Dennis & Van Horn, 1966) | Depletable budget tokens |
| Process scheduling (suspend/resume) | Checkpoint/replay with HITL |
| Virtual memory paging | Context window management |
| Preemptive interrupts | `asyncio.Task.cancel()` |

This analogy is not merely pedagogical; it is structural. The trust boundary between an LLM and external tools is real, and the primitives that operating systems use to manage untrusted processes translate directly to the agent setting.

### 1.3 Contributions

We make the following contributions:

1. **A capability-based security model for LLM agents.** Tools declare resource consumption; the kernel enforces depletable budgets with atomic delegation and reclamation. Budget exhaustion produces LLM-readable feedback rather than crashes.

2. **A checkpoint/replay execution model** that avoids coroutine serialization entirely. Agent state is a replay journal of completed syscalls. Suspend raises an interrupt to unwind the stack; resume replays from the top with cached responses. This single mechanism enables HITL, preemption, crash recovery, and multi-agent orchestration.

3. **True preemptive scheduling** via `asyncio.Task.cancel()`. The kernel can interrupt an agent at any `await` point, including every LLM streaming chunk boundary, achieving token-level preemption granularity without coupling the kernel to the LLM streaming protocol.

4. **A context window management subsystem (MMU)** that monitors token usage, pins critical messages, and evicts stale context via FIFO with semantic page-in for retrieval.

5. **A Phase 1 implementation** with 368 passing tests, zero lint errors, and integration demonstrations with smolagents and pydantic-ai.

---

## 2. Architecture

### 2.1 System Overview

Castor implements a strict microkernel architecture with two trust domains:

```
+===========================================================+
|                  USER SPACE  (untrusted)                  |
|   LLM Client    |   Agent Function    |    Client UI     |
+==================+====================+===================+
|             SYSCALL INTERFACE (trust boundary)            |
|                     SyscallProxy                          |
|         replay | validate | gate | execute | log          |
+===========================================================+
|                  KERNEL SPACE  (trusted)                  |
|   Gate      |  Scheduler  |  Capability  |     MMU        |
|  (validate  |  (replay    |  (budget     |  (context      |
|   execute)  |   HITL)     |   track)     |   memory)      |
+===========================================================+
|              SQLite Persistence Layer                      |
+===========================================================+
```

**User space** contains the LLM provider, agent functions, and UI. None of these components may execute side effects directly.

**Kernel space** contains four subsystems (Gate, Scheduler, Capability, and MMU) plus the LLM syscall wrapper. The kernel is fully deterministic: given the same syscall log, replaying an agent function produces the same execution trace.

**The syscall interface** (`SyscallProxy`) is the single bridge. Every tool call passes through a 9-step pipeline: replay check, kernel tool skip, tool resolution, schema validation, capability deduction, HITL gate, execution, response logging, and return.

### 2.2 The Syscall Pipeline

The 9-step pipeline enforces invariants on every live syscall:

1. **Replay check.** If a cached response exists, return it immediately. This step handles resume-from-checkpoint by serving cached responses until the agent catches up to the suspension point.

2. **Kernel tool skip.** Internal tools (e.g., `sys_kernel_page_out` for MMU eviction) are auto-skipped during replay because their side effects are baked into the checkpoint.

3. **Tool resolution.** The Gate registry looks up the tool by name and retrieves its metadata (Pydantic schema, capability requirement, risk flags).

4. **Schema validation.** Arguments are validated against the tool's Pydantic V2 schema. On failure, the agent receives structured feedback for self-correction, not a crash.

5. **Capability deduction.** The cost is deducted from the agent's budget before execution. If the budget is insufficient, the agent receives feedback.

6. **HITL gate.** If the tool is destructive or requires human approval, execution suspends via `SuspendInterrupt`. The checkpoint is persisted with the pending request.

7. **Execution.** The Gate calls the actual tool function.

8. **Response logging.** The request/response pair is appended to the `syscall_log`.

9. **Return.** The result is returned to the agent function.

If any step fails, the appropriate recovery action is taken: validation errors produce feedback, capability exhaustion produces feedback, HITL requirements produce suspension, and tool execution failures refund the deducted budget.

### 2.3 Data Model

The core data structures are Pydantic V2 models:

- **`AgentCheckpoint`**: the portable execution state. Contains the `syscall_log`, capability state, status, pending HITL request, preemption context, and result.
- **`SyscallRecord`**: a single entry in the replay journal: `{request, response, was_hitl, timestamp}`.
- **`Capability`**: a named budget with `max_budget` and `current_usage`.

The checkpoint status transitions through: `RUNNING` → `COMPLETED` | `SUSPENDED` | `PREEMPTED` | `FAILED`.

---

## 3. Capability-Based Security

### 3.1 The Capability Model

Following Dennis and Van Horn (1966), Castor implements capabilities as unforgeable tokens that grant measured access to a resource. Each capability is a named budget with a depletable balance:

```python
@castor_tool(consumes="api", cost_per_use=1.0)
async def web_search(query: str) -> list[str]: ...

@castor_tool(consumes="finance", cost_per_use=50.0,
             destructive=True, requires_hitl=True)
async def execute_trade(symbol: str, amount: float) -> dict: ...
```

The agent receives an initial budget at creation:

```python
cp = await kernel.run(agent, budgets={"api": 100.0, "finance": 5000.0})
```

### 3.2 Deduct-Before-Execute

The kernel enforces a strict deduct-before-execute policy:

1. **Check:** Is `remaining >= cost_per_use`?
2. **Deduct:** `remaining -= cost_per_use`
3. **Execute:** Run the tool.
4. **On exception:** Refund `remaining += cost_per_use`.

This prevents overcommitment: even if the tool fails, the budget was reserved. If the budget is insufficient, the agent receives structured feedback:

```
"Insufficient capability 'api': need 1.0, have 0.5 remaining."
```

The LLM can then adjust: use a cheaper alternative, reduce scope, or report the limitation. No crash, no unhandled exception.

### 3.3 Budget Delegation

Parent agents delegate portions of their budget to child agents via `spawn_agent`. Delegation is atomic:

1. **Validate all.** Check that the parent has sufficient budget for every delegated capability.
2. **Commit all.** Atomically deduct from parent, assign to child.
3. **Reclaim on completion.** Unused child budget returns to parent.

The conservation invariant holds: `delegate(amount) + reclaim(unused) = amount`. No budget is created or destroyed, only transferred.

### 3.4 Comparison with ACL-Based Approaches

Access Control Lists (ACLs) provide binary authorization: allowed or denied. Capabilities provide continuous authorization: a budget that depletes with use.

For LLM agents, the continuous model is strictly more practical:

- An agent "allowed to search" that makes 10,000 requests is as dangerous as one that's denied. Budgets prevent this.
- An agent that delegates tasks needs fine-grained resource sharing. ACL delegation creates privilege escalation risk; capability delegation is bounded by construction.
- Budget exhaustion produces actionable feedback that the LLM can reason about. ACL denial produces a binary rejection.

---

## 4. Checkpoint/Replay Determinism

### 4.1 Why Not Coroutine Serialization?

Castor needs to suspend agent execution and resume it later, potentially hours later, possibly in a different process. The naive approach is to serialize the coroutine state.

**This is impossible in Python.** `asyncio` coroutines hold C-level stack frames, event loop references, closures over mutable state, and non-serializable resources (file handles, network connections). You cannot `pickle.dumps()` a live coroutine.

An alternative (converting agent functions into explicit state machines) is possible but impractical. An agent with 10 tool calls requires 10+ phases with manual state management, conditional logic creates phase explosion, and the agent author must know they're running in a suspend/resume system.

### 4.2 The Replay Mechanism

Castor adopts a checkpoint/replay model inspired by Temporal.io and event sourcing. Agent functions are plain `async def` functions. The kernel records a log of completed syscalls. On resume, it replays the function from the top, serving cached responses:

```
First run:
  syscall("search", ...)    → executes, logs result, returns
  syscall("analyze", ...)   → executes, logs result, returns
  syscall("delete", ...)    → destructive! raises SuspendInterrupt
  Checkpoint saved: syscall_log = [search, analyze]

Resume (after human approval):
  syscall("search", ...)    → replay_index=0, return cached result
  syscall("analyze", ...)   → replay_index=1, return cached result
  syscall("delete", ...)    → replay_index=2, past cache → execute live
  Agent completes normally
```

The agent function runs twice, but the first two syscalls are served from cache: instant, deterministic, no side effects.

### 4.3 Determinism Guarantee

The key insight: **LLM agent functions are naturally deterministic between syscalls.** Given the same tool responses, the agent makes the same decisions, because the LLM calls are themselves syscalls captured in the log.

The proxy verifies this: on replay, if the agent issues a different syscall than what's in the log, a `ReplayDivergenceError` is raised, detecting corruption or non-deterministic agent code.

### 4.4 Replay Safety for Special Operations

- **HITL modification:** The original request is logged as `HITL_MODIFIED` with feedback. The kernel never mutates arguments; this would break replay.
- **Kernel tools:** `sys_kernel_page_out` (MMU eviction) is auto-skipped during replay; its side effects are baked into the checkpoint.
- **Child agents:** `spawn_agent` is just another syscall. The child's entire checkpoint becomes the response. On parent replay, the child is not re-run.

### 4.5 Comparison with Temporal and Event Sourcing

| System | Approach | Key difference |
|---|---|---|
| **Temporal.io** | Activity/workflow event sourcing | General-purpose; no security budgets or HITL |
| **Azure Durable Functions** | Orchestrator replay | Serverless-scoped; no context management |
| **Event Sourcing** | State = replay of events | Pattern, not a runtime; no enforcement |
| **Castor** | Syscall log replay | Agent-specific: budgets + HITL + context MMU |

Castor's `syscall_log` is structurally equivalent to Temporal's activity history, but purpose-built for LLM agents with integrated capability enforcement and context window management.

---

## 5. Human-in-the-Loop Control

### 5.1 Fast/Slow Path Separation

Castor divides tool calls into two execution paths:

- **Fast path:** Safe operations (searches, reads, computations) execute immediately. No human involvement, no suspension.
- **Slow path:** Destructive or high-stakes operations (`destructive=True`, `requires_hitl=True`) suspend for human approval before any execution.

This avoids the two failure modes of naive HITL: approving everything (unusable) or approving nothing (unsafe).

### 5.2 Suspension and Resume Protocol

When an agent calls a slow-path tool:

1. The proxy raises `SuspendInterrupt`, a `BaseException` that unwinds the coroutine stack.
2. The checkpoint is saved with `status = "SUSPENDED"` and `pending_hitl = {tool_name, arguments}`.
3. A human reviews the request.
4. The human chooses an action: approve, reject, or modify.
5. The agent resumes via checkpoint/replay.

### 5.3 Approve, Reject, Modify

| Action | Semantics |
|---|---|
| **Approve** | Execute the blocked tool with original arguments. Log with `was_hitl=True`. |
| **Reject** | Do NOT execute. Log as `HITL_REJECTED` with natural language feedback. The LLM re-plans. |
| **Modify** | Do NOT execute with original args. Log as `HITL_MODIFIED` with feedback. The LLM re-plans with guidance. |

The modify action deserves emphasis: the kernel **never mutates the pending arguments**. Doing so would break replay determinism; the syscall log must match the agent's actual execution trace. Instead, the human provides natural language feedback ("Only delete files older than 30 days"), and the LLM generates a new tool call that reflects this guidance.

### 5.4 Child Agent HITL Propagation

When a child agent encounters a HITL-required tool, the suspension propagates:

1. Child suspends → child checkpoint saved
2. Parent records child's checkpoint in its own syscall record
3. Parent suspends too
4. Human approves child's request
5. Parent resumes → reaches spawn point → child resumes via replay → child completes
6. Parent continues with child's result

This enables HITL for arbitrarily nested agent hierarchies.

---

## 6. Preemptive Scheduling

### 6.1 The Insight: Checkpoint/Replay Gives Preemption for Free

In a traditional OS, preemption requires saving arbitrary state (registers, stack, heap). In Castor's checkpoint/replay model, the `syscall_log` already captures all externally-visible state. Everything between two syscalls is pure recomputable work.

Therefore: **cancel the agent at any point, resume from the last checkpoint, lose nothing.**

### 6.2 Mechanism: `asyncio.Task.cancel()`

`asyncio.Task.cancel()` injects a `CancelledError` at the next `await` point. For I/O-bound LLM agents, the time between `await` points is typically milliseconds of CPU work. So `task.cancel()` is effectively immediate.

The critical observation: **90%+ of wall-clock time in LLM agents is spent in streaming inference.** An LLM streaming call is an async iteration where each chunk boundary is an `await` point:

```python
async for chunk in llm_stream(...):
    partial_response += chunk
    # CancelledError can be injected here, at every chunk
```

This achieves **token-level preemption granularity** (10-100ms latency) without any special mechanism; real LLM streaming APIs (aiohttp, httpx) have natural `await` points at every chunk.

### 6.3 Preemption Context

When an agent is preempted, the kernel attaches metadata to the checkpoint:

- `preemption_reason`: why it was interrupted (e.g., `HUMAN_ABORT`, `BUDGET_EXHAUSTED`)
- `preemption_payload`: structured data from the interrupter
- `partial_work`: mid-thought LLM output captured before interruption

This context is **not** part of the `syscall_log`; it doesn't affect replay determinism. It's injected after replay catches up, as new context for the agent's next decision. The agent can adapt without special handling in agent code.

### 6.4 The Microkernel Argument

An alternative architecture places the kernel in direct control of the LLM streaming loop, intercepting every token, maintaining an inner agent loop, and managing partial responses. We rejected this approach:

| Aspect | Kernel-owned loop | Castor (microkernel) |
|---|---|---|
| Agent flexibility | Fixed loop pattern | Arbitrary async functions |
| Kernel complexity | High (embeds LLM protocol) | Low (manages tasks only) |
| Preemption granularity | Token-level (explicit) | Token-level (natural await points) |
| Replay determinism | None | Full (syscall_log) |

Castor achieves the same preemption granularity without coupling the kernel to the LLM streaming protocol. **The kernel controls side effects, not reasoning.**

---

## 7. Context Window Management (MMU)

### 7.1 The Agentic MMU

The MMU subsystem manages the LLM's context window as an operating system's MMU manages physical memory:

| OS MMU | Castor MMU |
|---|---|
| Physical memory pages | Context window tokens |
| Page fault | Context overflow |
| LRU eviction | FIFO eviction |
| Swap space | Semantic memory store |
| Pinned pages | Pinned messages (system prompts) |

### 7.2 Eviction Mechanism

When the token count exceeds a configurable watermark threshold (e.g., 85% of the context window), the MMU evicts the oldest unpinned messages. Evicted content is stored in a semantic memory backend.

Eviction is routed through the SyscallProxy as a kernel tool (`sys_kernel_page_out`). The MMU never checks `is_replaying`; replay safety is handled by the proxy, which skips kernel tools during replay.

### 7.3 Semantic Page-In

Agents can retrieve evicted context via the `search_memory` tool:

```python
memories = await proxy.search_memory(query="user's budget constraints")
```

The `SemanticMemoryDriver` abstraction (an ABC) allows plugging in different backends: substring search for testing, vector search for production.

### 7.4 Limitations

Context paging is fundamentally lossy. Unlike real memory, evicted context is retrieved probabilistically via semantic search. If the LLM needs an exact detail from an evicted message, retrieval may fail. This is an acknowledged limitation of the LLM context paradigm, mitigated by pinning critical information and setting conservative watermarks.

---

## 8. Multi-Agent Orchestration

### 8.1 Synchronous Spawning

`spawn_agent` is a syscall that creates a child agent with its own `AgentCheckpoint`, `SyscallProxy`, and delegated capabilities. The parent blocks until the child completes.

Child PIDs are deterministic: `parent_pid::agent_name-N` (where N is the spawn sequence). This ensures replay produces the same PID assignments.

### 8.2 Asynchronous Fan-Out/Fan-In

`spawn_agent_async` launches a child without blocking; `join_agent` collects the result. Multiple children can execute concurrently:

```python
handle_a = await proxy.syscall("spawn_agent_async", ...)
handle_b = await proxy.syscall("spawn_agent_async", ...)
result_a = await proxy.syscall("join_agent", handle=handle_a)
result_b = await proxy.syscall("join_agent", handle=handle_b)
```

Budget delegation and reclamation work identically for sync and async spawning.

### 8.3 Future: Distributed Orchestration

The checkpoint-as-portable-state model suggests a natural extension to distributed execution: routing checkpoints across nodes, distributed budget tracking with consensus, cross-node agent migration, and cluster-level scheduling. This remains future work.

---

## 9. Comparison with Existing Frameworks

| Feature | Castor | LangChain | CrewAI | Temporal |
|---|---|---|---|---|
| Deterministic replay | Yes (syscall log) | No | No | Yes (event sourcing) |
| Budget management | Yes (capabilities) | No | No | No |
| HITL with modification | Yes (structured) | Manual | Manual | Yes (signals) |
| Context window management | Yes (MMU) | Token counting | Token counting | N/A |
| Sub-agent spawning | Yes (sync + async) | Chains | Agent delegation | Child workflows |
| Type-safe tool validation | Yes (Pydantic V2) | Yes (Pydantic) | Partial | Schema-based |
| Preemptive scheduling | Yes (task cancel) | No | No | Yes (cancel) |

**Castor's unique contribution** is combining deterministic replay with capability-based security and context window management in a single coherent kernel. The `castor.lib` standard library further simplifies agent development with proxy-free primitives and composable patterns (ReAct, supervisor, map-reduce). No existing framework provides all three.

---

## 10. Related Work

**Temporal.io** (2020). Durable execution platform based on event sourcing. Activities (side effects) are recorded; workflows (orchestration logic) are replayed. Castor's syscall log is structurally similar to Temporal's activity history, but Castor adds capability-based budgets, HITL with modification, and context window management, features specific to LLM agent workloads.

**seL4** (Klein et al., 2009). Formally verified microkernel with capability-based security. Castor draws direct inspiration from seL4's capability model, specifically unforgeable tokens granting bounded access to resources. seL4 proves capability safety properties formally; Castor validates them empirically with tests.

**LangChain / LangGraph** (Chase, 2022). Popular agent framework with tool registration and chain composition. Provides no security boundary, no replay, no budget management. Castor can wrap LangChain tools as a guard layer.

**CrewAI** (Moura, 2023). Multi-agent framework with agent delegation. No capability model, no checkpoint/replay, no formal HITL mechanism.

**AutoGen** (Wu et al., 2023). Multi-agent conversational framework from Microsoft Research. Focuses on agent conversation patterns rather than security primitives.

**Dennis & Van Horn** (1966). The original capability-based security model: unforgeable tokens granting access to resources. Castor extends this model with depletable budgets and atomic delegation, natural extensions for non-deterministic LLM agents that consume resources unpredictably.

**Liedtke** (1996). "Towards Real Microkernels," the argument for minimum mechanism in kernel design. Castor's microkernel principle (control side effects, not reasoning) follows directly.

---

## 11. Future Work

The primary next step is **castord**, a Rust implementation of the Castor kernel as a standalone daemon. Moving the kernel from Python to Rust provides memory safety, lower latency, and the ability to enforce security invariants at the process boundary rather than relying on in-process trust.

---

## 12. Conclusion

Castor demonstrates that the microkernel paradigm, proven over decades in operating systems, translates effectively to LLM agent security. The checkpoint/replay execution model avoids the impossible problem of coroutine serialization while providing crash recovery, human-in-the-loop control, and preemption from a single mechanism. Capability-based budgets prevent resource abuse by construction, not by policy. Context window management brings memory management principles to the finite attention of LLMs.

The key architectural insight is the **fast/slow path separation** combined with **the syscall boundary**: safe operations execute at full speed while dangerous ones are gated by human judgment, and the deterministic replay log captures all externally-visible state. This allows the kernel to remain minimal (it controls side effects, not reasoning) while still providing comprehensive security guarantees.

---

## References

[1] Dennis, J. B., & Van Horn, E. C. (1966). Programming semantics for multiprogrammed computations. *Communications of the ACM*, 9(3), 143–155.

[2] Klein, G., Elphinstone, K., Heiser, G., et al. (2009). seL4: Formal verification of an OS kernel. *Proceedings of the ACM SIGOPS 22nd Symposium on Operating Systems Principles (SOSP '09)*.

[3] Liedtke, J. (1996). Towards real microkernels. *Communications of the ACM*, 39(9), 70–77.

[4] Temporal Technologies, Inc. (2020). Temporal: Durable execution platform. https://temporal.io

[5] Chase, H. (2022). LangChain. https://langchain.com

[6] Moura, J. (2023). CrewAI: Framework for orchestrating role-playing AI agents. https://crewai.com

[7] Wu, Q., Bansal, G., Zhang, J., et al. (2023). AutoGen: Enabling next-gen LLM applications via multi-agent conversation. *arXiv preprint arXiv:2308.08155*.

[8] Pydantic V2. https://docs.pydantic.dev
