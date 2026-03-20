---
sidebar_position: 1
slug: /intro
---

# What is Castor?

**The secure execution layer for AI agents.** Budgets that cap spending. Human approval before dangerous actions. Pause anywhere, resume later, replay deterministically.

Castor intercepts every tool call your agent makes, enforces resource limits, and gates destructive operations for human review. Your agent's business logic stays untouched. It's not a framework; it's the layer underneath.

Agent frameworks give LLMs tools but don't control how those tools are used. Castor inverts this: **the agent doesn't call tools, it requests them.** Every side effect is a syscall that passes through a kernel. The kernel validates, budgets, gates, and logs before anything executes.

## The Problem

LLM agents execute tools (API calls, file operations, code execution) based on non-deterministic attention mechanisms. Current agent frameworks provide no security boundary between the LLM and external resources. This leads to three failure modes:

- **Privilege abuse:** An agent calls a destructive tool it shouldn't have access to, or exceeds reasonable usage limits.
- **Resource exhaustion:** An agent burns through API credits, makes thousands of requests, or enters an infinite loop.
- **Context amnesia:** Long-running agents overflow their context window and forget critical instructions.

## The Operating System Analogy

Castor borrows proven concepts from operating system design:

| OS Concept | Castor Analog | Why it fits |
|---|---|---|
| User / Kernel space | LLM vs. Engine | The trust boundary is real, not metaphorical |
| System calls | Tool invocations via `proxy.syscall()` | LLM can only act through a validated gate |
| Capabilities | Budget tokens | Resource control that degrades gracefully |
| Process scheduling | Agent lifecycle (suspend/resume/preempt) | HITL maps to process control signals |
| Virtual memory paging | Context window management (MMU) | Finite "memory" with eviction strategies |

## Architecture at a Glance

Castor has four kernel subsystems:

| Subsystem | Module | Purpose |
|---|---|---|
| **Gate** | `castor.gate` | Tool registry with Pydantic V2 validation. Intercepts LLM output, validates types, provides self-correction feedback. |
| **Scheduler** | `castor.scheduler` | Checkpoint/replay scheduler. Manages the syscall pipeline, HITL suspension, and preemptive cancellation. |
| **Capability** | `castor.capability` | Budget tracking with atomic delegation. Token-bucket quotas per resource type. |
| **MMU** | `castor.mmu` | Context window memory management. FIFO eviction, system prompt pinning, semantic page-in. |
| **Lib** | `castor.lib` | Agent developer standard library: `tool()`, `chat()`, `parallel()`, `react()`, `spawn()`, and more. |

All kernel subsystems are accessed through the **SyscallProxy** or implicitly via `castor.lib` functions. Agent functions route every side effect through the kernel; this is the trust boundary.

## Security Scope

Castor provides **application-layer control**: it gates what the agent *intends* to do (tool calls, budgets, approval). It does **not** sandbox the process (filesystem, network). For defense-in-depth, run Castor inside a container or use [Roche](https://github.com/substratum-labs/roche), a sandbox orchestrator designed for AI agents. Castor controls intent; your infrastructure controls capability.

## Next Steps

- [Installation](./getting-started/installation): install Castor with pip or uv
- [Quickstart](./getting-started/quickstart): build your first guarded agent in 5 minutes
- [Core Concepts](./getting-started/concepts): understand syscalls, capabilities, and HITL
- [Architecture Overview](./architecture/overview): deep dive into the four subsystems
