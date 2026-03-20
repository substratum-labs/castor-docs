---
sidebar_position: 100
---

# Roadmap

## Phase 1: Python Prototype (Complete)

All core PRD requirements are implemented with 368 passing tests.

| Milestone | Status | Features |
|---|---|---|
| M1: Core Kernel | Complete | Gate (tool registry), Capability Manager, tool validation, self-correction feedback |
| M2: Scheduler | Complete | SyscallProxy 9-step pipeline, checkpoint/replay, HITL approve/reject/modify |
| M3: Memory | Complete | MMU (context window management), FIFO eviction, pinning, semantic page-in |
| M4: Multi-Agent | Complete | Sync spawn, async spawn/join, CLI, child HITL propagation |
| M5: Streaming | Complete | StreamingLLMSyscall, token-level preemption, partial_work capture, proportional budget |

### Post-M5 Improvements

- **V2 API** — `Castor` facade class with sensible defaults, HITL policies, structured results
- **V2.1 Integration Improvements** — budget skip on untracked resources, `ToolMetadata.from_function()`, `MemoryCheckpointStore`, `CheckpointStoreProtocol`, public kernel properties, `default_budgets`, empty schema passthrough
- **MCP Server** — expose `@castor_tool` as MCP tools via FastMCP for any MCP-compatible agent
- **Guard Layer Demos** — smolagents (L1 + L2) and pydantic-ai (L1 + L2) integration examples

### Phase A: Naming Overhaul

Dam → Gate (`SyscallGate`), Stream → Scheduler, Lodge → MMU. Aligns public API with OS analogy.

### Phase B: castor.lib

Agent developer standard library: `tool()`, `chat()`, `budget()`, `spawn()`, `join()`, `parallel()`, `react()`, `map_reduce()`, `plan_execute()`, `conversation()`, `supervisor()`, `run_task()`.

### Phase C: CLI

Expanded CLI: `castor run`, `castor ps`, `castor inspect`, `castor reject`, `castor modify`.

## Phase 2: Rust Daemon — castord (Planned)

The original Phase 2 plan (PyO3 coprocessor) has been superseded by a more ambitious design: **castord**, an seL4-inspired microkernel daemon implemented as a single Rust binary.

### Architecture

- **Kernel Actor** — pure state machine: `fn handle(KernelOp) -> Vec<Effect>`, zero I/O inside the kernel
- **Internal Actor model** — mpsc channels between components, no shared mutable state
- **Three protocols:**
  - **AISA** — agent ↔ daemon communication
  - **ATSP** — daemon ↔ tool execution (Castor's own protocol)
  - **MCP bridge** — optional compatibility with MCP-based tools
- **Gate validation** inside Kernel Actor (seccomp-bpf model, pure function)

### HITL Three-Layer Model

1. **Plan-level** — approve/reject entire agent plans
2. **Intent-level** — `confirm()` in castor.lib for agent-initiated human checks
3. **Operation-level** — kernel safety net for destructive tools

### Sandbox

Sandbox is an **infrastructure concern**, not a kernel concern. The kernel performs declarative label checks; actual isolation is delegated to external tools like [Roche](https://github.com/substratum-labs/roche).

**Delivery format:** Developers still use `import castor` in Python. The daemon runs as a sidecar process (`castord`).

## Companion Projects

### Roche (Sandbox Orchestration)

[Roche](https://github.com/substratum-labs/roche) is an independent, universal sandbox orchestrator for AI agents:

- Create/exec/destroy sandboxes with multi-provider support (Docker, Firecracker, WASM)
- AI-optimized security defaults (no network, readonly FS, timeout by default)
- Rust CLI + Python SDK

Castor controls *intent* (what the agent wants to do); Roche controls *capability* (what the process can do). They complement each other but have no code dependency.

## Future Directions

- Production `SemanticMemoryDriver` with vector search
- OpenTelemetry observability — structured spans per syscall
- Distributed agent orchestration via portable checkpoints
- Formal verification of budget conservation, HITL safety, and replay determinism
