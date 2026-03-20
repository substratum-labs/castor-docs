---
sidebar_position: 5
---

# castor.lib: Agent Developer API

`castor.lib` is the standard library for agent developers. It provides a clean, proxy-free API for writing agents, with no kernel imports and no `SyscallProxy` parameter.

## Why castor.lib?

Castor separates two roles:

| Role | Package | What they do |
|---|---|---|
| **Operator** | `castor` | Register tools, create kernel, set budgets, handle HITL |
| **Agent Developer** | `castor.lib` | Write agent logic using `tool()`, `chat()`, `spawn()`, patterns |

Agent code only imports from `castor.lib`. The proxy is injected at runtime via a `ContextVar`; agents don't need to know how the kernel works.

## Quick Start

```python
from castor import Castor, castor_tool
from castor.lib import tool, chat, budget

# Operator: register tools
@castor_tool(consumes="api", cost_per_use=1.0)
async def web_search(query: str) -> list[str]:
    return [f"Result for '{query}'"]

# Agent developer: write agent using castor.lib
async def my_agent() -> str:
    results = await tool("web_search", query="castor")
    remaining = budget("api")
    return f"Found {len(results)} results ({remaining} budget left)"

# Operator: run it
kernel = Castor(tools=[web_search])
cp = await kernel.run(my_agent, budgets={"api": 10.0})
```

## Three API Levels

### Level 0: run_task()

One sentence in, result out. Auto-discovers registered tools and runs a ReAct loop:

```python
from castor.lib import run_task

async def agent() -> str:
    return await run_task("Find the weather in Paris and convert to Fahrenheit")
```

### Level 1: Patterns

Composable patterns for common agent architectures:

```python
from castor.lib import parallel, react, supervisor

async def agent() -> str:
    # Run multiple tools
    search_result, calc_result = await parallel(
        ("web_search", {"query": "weather paris"}),
        ("calculator", {"expression": "22 * 9/5 + 32"}),
    )

    # ReAct loop: LLM decides which tools to use
    answer = await react(
        "What is the weather in Paris in Fahrenheit?",
        tools=["web_search", "calculator"],
    )

    return answer
```

### Level 2: Primitives

Direct tool calls for maximum control:

```python
from castor.lib import tool, chat, budget, try_tool

async def agent() -> str:
    data = await tool("web_search", query="castor microkernel")
    summary = await chat(f"Summarize: {data}")
    remaining = budget("api")
    return summary
```

## Primitives Reference

### tool(name, **kwargs)

Call any registered tool by name:

```python
results = await tool("web_search", query="castor")
```

### chat(prompt, *, system="", tool_name="llm_inference")

Call an LLM tool:

```python
response = await chat("Summarize this data", system="You are a helpful assistant")
```

### budget(resource)

Check remaining budget for a resource type:

```python
remaining = budget("api")
if remaining < 5.0:
    return "Running low on budget"
```

### try_tool(name, **kwargs)

Semantic alias for `tool()`. Communicates that failure is an expected outcome:

```python
result = await try_tool("risky_operation", data="test")
```

### spawn(agent_name, *, capabilities=None)

Spawn a child agent asynchronously:

```python
handle = await spawn("researcher", capabilities={"api": 10.0})
```

### join(handle)

Wait for a spawned child agent to complete:

```python
result = await join(handle)
```

## Pattern Reference

### parallel(*tool_calls)

Execute multiple tool calls, return results in order:

```python
results = await parallel(
    ("search", {"query": "topic A"}),
    ("search", {"query": "topic B"}),
)
# results[0] = topic A results, results[1] = topic B results
```

### react(goal, tools, *, max_steps=10, tool_name="llm_inference")

ReAct loop: the LLM thinks, acts (calls tools), and observes until it outputs `FINISH`:

```python
answer = await react(
    "Research AI safety and summarize findings",
    tools=["web_search", "summarize"],
    max_steps=5,
)
```

### map_reduce(items, map_tool, reduce_tool)

Map each item through a tool, then reduce all results:

```python
summary = await map_reduce(
    items=["topic1", "topic2", "topic3"],
    map_tool="research",
    reduce_tool="summarize",
)
```

### plan_execute(goal, executor_tools, *, tool_name="llm_inference")

LLM generates a JSON plan, then executes each step:

```python
result = await plan_execute(
    "Analyze the market and send a report",
    executor_tools=["web_search", "analyze", "send_email"],
)
```

### conversation(system, *, max_turns=20)

Multi-turn chat loop between user input and LLM:

```python
history = await conversation(
    "You are a helpful research assistant.",
    max_turns=10,
)
```

### supervisor(task, agents, *, max_rounds=5)

LLM decides which registered agent to delegate to:

```python
result = await supervisor(
    "Research AI safety and publish a report",
    agents=["researcher", "writer", "publisher"],
)
```

## Best Practices

### Use parallel() instead of asyncio.create_task

`castor.lib` functions rely on a `ContextVar` to access the kernel proxy. Python's `asyncio.create_task()` copies the current context correctly, so it will usually work, but raw tasks bypass Castor's syscall log and break checkpoint/replay determinism.

**Always use `parallel()` for concurrent tool calls:**

```python
# ✅ Correct: tracked in syscall log, replay-safe
results = await parallel(
    ("web_search", {"query": "topic A"}),
    ("web_search", {"query": "topic B"}),
)

# ❌ Avoid: bypasses syscall log, breaks replay
import asyncio
t1 = asyncio.create_task(tool("web_search", query="topic A"))
t2 = asyncio.create_task(tool("web_search", query="topic B"))
results = await asyncio.gather(t1, t2)
```

If you must use `asyncio.create_task()` (e.g. for non-tool background work), be aware that any `tool()` or `chat()` calls inside the task **will not be replayed correctly** on checkpoint resume.

### spawn() + join() vs SyscallProxy.spawn_sync()

For child agents, prefer the async `spawn()` + `join()` pattern over `proxy.spawn_sync()`:

```python
# ✅ Preferred: parent can do work between spawn and join
handle = await spawn("researcher", capabilities={"api": 10.0})
# ... parent continues working ...
result = await join(handle)

# ⚠️ spawn_sync blocks the parent until child completes
# If the child triggers HITL, the parent hangs too
result = await proxy.spawn_sync("researcher", capabilities={"api": 10.0})
```

`spawn_sync` is convenient for simple scripts, but be aware:
- If the child agent suspends for HITL approval, the **parent agent suspends too**, and the entire chain blocks.
- The parent cannot do any useful work while waiting.
- `asyncio.Task.cancel()` cannot interrupt the child mid-execution; it must complete or suspend first.

For production multi-agent systems, use `spawn()` + `join()` (or `castor.lib.supervisor()`) to retain control.

## CLI: castor run

Run agents from the command line using `file:func` syntax:

```bash
# Run a specific function
castor run examples/06_lib_primitives.py:research_agent --budget api=10

# Convention: looks for `agent` or `main` function
castor run my_agent.py --budget api=100 --hitl interactive
```

## Further Reading

- [Multi-Agent Guide](./multi-agent): spawn/join patterns and budget delegation
- [API Reference](https://substratum-labs.github.io/castor/api/lib/): complete function signatures
