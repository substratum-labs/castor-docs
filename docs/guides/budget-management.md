---
sidebar_position: 3
---

# Budget Management

This guide covers practical patterns for configuring and managing capability budgets in Castor.

## Setting Initial Budgets

When running an agent, provide a budget dictionary:

```python
kernel = Castor(tools=[web_search, delete_files, execute_trade])

cp = await kernel.run(
    agent,
    budgets={
        "api": 100.0,       # 100 API calls
        "disk": 20.0,       # 20 disk operations
        "finance": 5000.0,  # $5000 trading limit
    },
)
```

Budget names are arbitrary strings; they match the `consumes` parameter on tool decorators.

### Default Budgets

Set org-wide defaults on the kernel so individual `run()` calls don't need to repeat budget configuration:

```python
kernel = Castor(
    tools=[web_search, delete_files, execute_trade],
    default_budgets={"api": 100.0, "disk": 20.0, "finance": 5000.0},
)

# Uses default_budgets automatically
cp = await kernel.run(agent)

# Explicit budgets override the default
cp = await kernel.run(agent, budgets={"api": 50.0})
```

### Running Without Budgets

When no budgets are configured (neither `budgets=` nor `default_budgets=`), tools with `cost_per_use` execute without enforcement. The budget system treats untracked resource types as unlimited.

## Defining Tool Costs

Tools declare what they consume and how much:

```python
@castor_tool(consumes="api", cost_per_use=1.0)
async def web_search(query: str) -> list[str]: ...

@castor_tool(consumes="api", cost_per_use=5.0)
async def deep_research(topic: str) -> dict: ...

@castor_tool(consumes="finance", cost_per_use=50.0,
             destructive=True, requires_hitl=True)
async def execute_trade(symbol: str, amount: float) -> dict: ...
```

Multiple tools can consume the same capability with different costs. A `web_search` costs 1.0 API credits; a `deep_research` costs 5.0.

## Monitoring Budget Usage

After execution, inspect the checkpoint:

```python
for name in cp.capabilities:
    used = cp.budget_used(name)
    remaining = cp.budget_remaining(name)
    total = used + remaining
    print(f"{name}: {used}/{total} used ({remaining} remaining)")
```

## Delegation Patterns

### Fixed Budget Delegation

Give each child a fixed portion:

```python
async def manager(proxy: SyscallProxy):
    for topic in topics:
        result = await proxy.syscall("spawn_agent",
            agent_name="researcher",
            budgets={"api": 20.0})  # Each child gets exactly 20
```

### Proportional Delegation

Divide the remaining budget across children:

```python
async def manager(proxy: SyscallProxy):
    per_child = remaining_budget / len(topics)
    for topic in topics:
        result = await proxy.syscall("spawn_agent",
            agent_name="researcher",
            budgets={"api": per_child})
```

### Conservative Delegation

Reserve budget for the parent's own needs:

```python
async def manager(proxy: SyscallProxy):
    # Reserve 10 for the manager's own reporting
    available = total_budget - 10.0
    per_child = available / len(topics)
    for topic in topics:
        result = await proxy.syscall("spawn_agent",
            agent_name="researcher",
            budgets={"api": per_child})
    # Manager still has ~10.0 for its own tool calls
    await proxy.web_search(query="summarize findings")
```

## Handling Exhaustion

When the budget is insufficient, the agent receives a response (not an exception):

```json
{
  "status": "INSUFFICIENT_CAPABILITY",
  "feedback": "Insufficient capability 'api': need 1.0, have 0.5 remaining."
}
```

Well-designed agents handle this by adjusting their plan:
- Use a cheaper tool
- Reduce the scope of work
- Report back to the user/parent that they need more budget

## Further Reading

- [Capability Model](../architecture/capability-model): the theory behind capabilities
- [Multi-Agent](./multi-agent): delegation in multi-agent setups
