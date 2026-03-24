---
slug: introducing-castor
title: "Introducing Castor: A Secure Microkernel for LLM Agents"
authors: [substratum-labs]
tags: [announcement, architecture]
---

Your agent just deleted a production database. It was trying to help, "cleaning up unused tables." The framework gave it the tool. The framework had no way to say "not that much."

Castor is the layer that says "not that much." It's a **microkernel** for LLM agents. In the same way that an OS kernel treats user processes as untrusted code and mediates their access to system resources, Castor treats the LLM as untrusted and mediates its access to external tools. It enforces resource budgets, gates destructive operations for human review, and manages context memory. It's not a framework. Your agent's logic stays untouched.

<!-- truncate -->

## Why This Exists

Three failure modes keep showing up in production agents:

**Privilege abuse.** An agent with file access decides to "clean up" and wipes data. If a tool is registered, the agent can call it without restriction. There's no budget, no distinction between a read and a destructive write.

**Resource exhaustion.** "Research this thoroughly" turns into 3,000 API calls. No spending limit, no cost tracking, no circuit breaker.

**Context amnesia.** After a long conversation, the agent forgets its own safety instructions, silently pushed out of the context window.

Every major framework (LangChain, CrewAI, AutoGen, OpenAI Agents, Google ADK) has the same gap: **no security boundary between the LLM and the outside world.** Castor adds that boundary.

## 30 Seconds to See It Work

```bash
pip install castor-kernel
```

Define tools with cost and risk metadata:

```python
from castor import Castor, castor_tool

@castor_tool(consumes="api", cost_per_use=1.0)
async def web_search(query: str) -> list[str]:
    return [f"Result for '{query}'"]

@castor_tool(consumes="disk", cost_per_use=1.0,
             destructive=True, requires_hitl=True)
async def delete_file(path: str) -> str:
    os.remove(path)
    return f"Deleted {path}"
```

Write a plain async agent function. No special base class needed:

```python
async def my_agent(proxy):
    results = await proxy.syscall("web_search", query="old temp files")
    await proxy.syscall("delete_file", path="/tmp/stale.log")
    return "Done"
```

Run with budgets:

```python
kernel = Castor(tools=[web_search, delete_file])
cp = await kernel.run(my_agent, budgets={"api": 10.0, "disk": 3.0})

if cp.is_suspended:
    print(cp.pending_tool, cp.pending_args)  # delete_file needs approval
    await kernel.approve(cp)
    cp = await kernel.run(my_agent, checkpoint=cp)
```

Or from the CLI:

```bash
castor run agent.py --budget api=10 disk=3
castor inspect <pid>
castor approve <pid>
```

The agent never knows Castor is there. It calls tools the same way it always did. But now every call passes through a capability boundary.

## The OS Analogy

This pattern isn't new. An LLM agent calling tools is structurally identical to an untrusted user-space process requesting access to system resources. Both need a trusted intermediary that enforces policy:

| OS Concept | Castor Analog |
|---|---|
| User / kernel space | LLM agent / execution engine |
| System calls | Tool invocations via `proxy.syscall()` |
| Capabilities | Depletable budget tokens |
| Process scheduling | Checkpoint/replay with HITL |
| Virtual memory | Context window management (MMU) |
| Preemptive interrupts | Token-level task cancellation |

Castor applies these proven primitives to the LLM agent setting. We go deep on each mechanism in our [technical deep-dive](/blog/why-os-kernel).

## Two Core Mechanisms

### Capability-Based Budgets

Tools declare what they consume. The kernel enforces limits **by construction**: there is no code path that executes a tool without deducting the budget first. When the budget is exhausted, the agent gets structured feedback and adjusts its plan:

```
"Insufficient capability 'api': need 1.0, have 0.5 remaining."
```

Parent agents delegate portions of their budget to child agents. The conservation invariant holds: no budget is created or destroyed, only transferred.

### Checkpoint/Replay with Human-in-the-Loop

You can't pickle a Python coroutine. Castor doesn't try. It records every completed tool call in a replay journal. When a destructive tool is encountered, the agent suspends. A human reviews and chooses: **approve**, **reject** (with feedback), or **modify** (with guidance). The agent resumes via replay: cached responses for completed calls, live execution from the suspension point.

One mechanism gives you HITL, crash recovery, suspend/resume, and preemption, all for free. Details in the [deep-dive](/blog/why-os-kernel).

## Four Ways to Use It

**Python library.** Direct `Castor` kernel API, full control.

**CLI.** `castor run`, `castor ps`, `castor inspect`, `castor approve`, `castor reject`, `castor modify`.

**MCP server.** `castor-mcp --tools-module tools` exposes your `@castor_tool` functions to any MCP-compatible agent (Claude Desktop, Cursor, etc.) with budget and HITL built in.

**Guard layer.** Wrap your existing framework. We ship integrations for smolagents, pydantic-ai, LangChain, CrewAI, OpenAI Agents, AutoGen, and Google ADK.

## What Castor Does Not Do

Castor provides **application-layer control**: what the agent intends to do. It does not sandbox the process. It won't prevent a malicious tool from accessing the filesystem or network directly.

For defense in depth, pair Castor with infrastructure-level isolation. [Roche](https://github.com/substratum-labs/roche) is our companion sandbox orchestrator: multi-provider (Docker, Firecracker, WASM) with AI-optimized security defaults. Castor controls intent. Roche controls capability. Independent projects, designed to work together.

## Current Status

`pip install castor-kernel`. Apache 2.0, Python 3.11+.

- 169 tests, zero lint errors
- Core subsystems: Gate, Scheduler, MMU, Capability
- Multi-agent spawning (sync + async) with budget delegation
- `castor.lib` standard patterns: `run_task()`, `react()`, `supervisor()`, `map_reduce()`, `conversation()`
- Full CLI and MCP server

## What's Next

**castord**, an seL4-inspired Rust microkernel daemon. The kernel becomes a pure state machine with zero I/O, communicating via dedicated protocols. The binary ships inside the Python wheel and is auto-managed. `Castor()` spawns it transparently and falls back to the pure-Python kernel if unavailable. You still just `pip install castor-kernel`.

Read the [whitepaper](/docs/whitepaper/) for the full technical treatment, or jump to the [quickstart](/docs/getting-started/quickstart) to try it yourself.

---

*[GitHub](https://github.com/substratum-labs/castor) · [API Reference](https://substratum-labs.github.io/castor/) · [PyPI](https://pypi.org/project/castor-kernel/)*
