---
sidebar_position: 4
---

# Framework Integration

Castor is designed to work as a standalone kernel or as a **guard layer** for existing agent frameworks. This guide shows how to integrate Castor with popular frameworks.

## Integration Architecture

Castor provides two integration levels:

| Level | What it adds | Complexity |
|---|---|---|
| **L1 (Guard)** | Budget enforcement + HITL approval before tool execution | Low: wrap tool calls |
| **L2 (Deep Guard)** | L1 + checkpoint/replay for crash recovery and HITL suspend/resume | Medium: wrap tool calls + model |

Both levels work by intercepting tool calls at the framework's extension point; no agent code changes needed.

## smolagents Integration

smolagents uses `ToolCallingAgent` with an `execute_tool_call()` method that can be overridden.

### L1: Budget + HITL Guard

```python
from smolagents import ToolCallingAgent
from castor import Castor, castor_tool

class CastorGuardedAgent(ToolCallingAgent):
    def __init__(self, castor_kernel, budgets, **kwargs):
        super().__init__(**kwargs)
        self.kernel = castor_kernel
        self.budgets = budgets

    def execute_tool_call(self, tool_name, arguments):
        # Check budget and HITL before calling the tool
        # Raises CapabilityExhaustedError if over budget
        # Raises SuspendInterrupt if HITL required
        self.kernel.guard(tool_name, arguments, self.budgets)
        return super().execute_tool_call(tool_name, arguments)
```

### L2: Checkpoint/Replay

L2 adds a `ReplayModel` that wraps the LLM model to record/replay LLM responses alongside tool calls. On resume, the model serves cached responses during replay, then switches to live inference.

See the complete implementation in [`examples/smolagents_guard/`](https://github.com/substratum-labs/castor/tree/main/examples/smolagents_guard).

## pydantic-ai Integration

pydantic-ai uses `WrapperToolset` with a `call_tool()` method; no agent subclassing needed.

### L1: Budget + HITL Guard

```python
from pydantic_ai import Agent
from pydantic_ai.toolsets import WrapperToolset

class CastorGuardedToolset(WrapperToolset):
    def __init__(self, wrapped, castor_kernel, budgets):
        super().__init__(wrapped)
        self.kernel = castor_kernel
        self.budgets = budgets

    async def call_tool(self, call, **kwargs):
        # Check budget and HITL before calling the tool
        self.kernel.guard(call.tool_name, call.args, self.budgets)
        return await super().call_tool(call, **kwargs)
```

### L2: Checkpoint/Replay

L2 uses a `SyscallJournal` shared object to track tool calls and LLM responses. A `ReplayModel` wraps the pydantic-ai `Model` to intercept `request()` calls.

See the complete implementation in [`examples/pydantic_ai_guard/`](https://github.com/substratum-labs/castor/tree/main/examples/pydantic_ai_guard).

## MCP Server Integration

For MCP-compatible agents (Claude, Cursor, or any MCP client), Castor provides a built-in MCP server that exposes `@castor_tool` functions as MCP tools with budget enforcement and HITL approval, with zero agent-side code changes needed.

### Define tools and run

```python
# tools.py
from castor import castor_tool

@castor_tool(consumes="api", cost_per_use=1.0)
async def search(query: str) -> list[str]:
    return [f"Result for: {query}"]

@castor_tool(consumes="disk", destructive=True)
def delete_files(paths: list[str]) -> int:
    return len(paths)
```

```bash
castor-mcp --tools-module tools
```

### Claude Desktop configuration

Add Castor as an MCP server in your Claude Desktop config:

```json
{
  "mcpServers": {
    "castor": {
      "command": "castor-mcp",
      "args": ["--tools-module", "tools"]
    }
  }
}
```

### Programmatic usage

```python
from castor.mcp.server import create_mcp_server

server = create_mcp_server(tools=[search, delete_files])
server.run(transport="stdio")
```

Budget enforcement and HITL approval work identically to the native Castor kernel: destructive tools suspend for human review, budgets deplete per call.

See [`examples/mcp_server/`](https://github.com/substratum-labs/castor/tree/main/examples/mcp_server).

## Key Integration Patterns

### Hook Point: Before Tool Execution

The common pattern across frameworks: intercept the tool call **before** it reaches the actual tool function. Check budget, check HITL, then proceed or suspend.

### Programmatic Tool Registration

For frameworks with their own tool definitions, use `ToolMetadata.from_function()` instead of the `@castor_tool` decorator:

```python
from castor import ToolMetadata

meta = ToolMetadata.from_function(
    existing_tool_fn,
    consumes="api",
    cost_per_use=1.0,
    destructive=True,
)
```

This auto-generates the JSON Schema from type hints and detects async; no decorator needed.

### Accessing Kernel Internals

For guard layers that need the Gate or CapabilityManager directly, use public properties:

```python
kernel = Castor(tools=[...])
kernel.gate                 # SyscallGate instance
kernel.capability_manager   # CapabilityManager instance
kernel.store                # CheckpointStore or None
```

### Record/Replay for LLM Calls

For L2 (checkpoint/replay), you need to record LLM responses during the first run and replay them on resume. This ensures the framework makes the same tool-call decisions during replay.

### Shared Mutable State

Some frameworks use `dataclasses.replace()` or similar immutable update patterns. When integrating with Castor, use a shared mutable object (like `SyscallJournal`) to survive state copies.

### Testing with MemoryCheckpointStore

Use `MemoryCheckpointStore` for integration tests (no SQLAlchemy dependency):

```python
from castor import MemoryCheckpointStore

store = MemoryCheckpointStore()
kernel = Castor(tools=[...], store=store)
```

## Further Reading

- [Architecture Overview](../architecture/overview): how the kernel works
- [Checkpoint/Replay](../architecture/checkpoint-replay): the execution model behind L2
