---
sidebar_position: 4
---

# Capability-Based Security

Castor uses capability-based security (depletable budget tokens) instead of traditional access control lists (ACLs). This document explains the model, its semantics, and how it compares to alternatives.

## Why Capabilities, Not ACLs?

ACLs say "who can do what." Capabilities say "how much can you still do."

For LLM agents, capabilities are far more practical:

| ACL Approach | Capability Approach |
|---|---|
| "Agent X can use web_search" | "Agent X has 50 API credits remaining" |
| Binary: allowed or denied | Continuous: budget depletes per use |
| No cost awareness | Every operation has an explicit cost |
| Privilege escalation risk | Delegation prevents escalation by construction |
| Hard failure on deny | Graceful degradation with feedback |

An LLM agent that's "allowed to search" but makes 10,000 requests is just as dangerous as one that's not allowed at all. Budgets solve the real problem.

## Token-Bucket Model

Each capability is a named budget with a remaining balance:

```python
cp = await kernel.run(
    agent,
    budgets={"api": 100.0, "disk": 20.0, "finance": 1000.0},
)
```

Tools declare what they consume:

```python
@castor_tool(consumes="api", cost_per_use=1.0)
async def web_search(query: str) -> list[str]: ...

@castor_tool(consumes="finance", cost_per_use=50.0, destructive=True)
async def execute_trade(symbol: str, amount: float) -> dict: ...
```

The kernel uses **deduct-before-execute** semantics: the cost is reserved before the tool runs, preventing overcommitment. If the tool fails, the budget is refunded. When budget is insufficient, the agent receives structured feedback and can adapt its plan (use a cheaper tool, reduce scope, or request more budget). No crash, no exception.

## Budget Delegation

Parent agents can delegate portions of their budget to child agents via `spawn_agent`:

```python
async def parent(proxy: SyscallProxy):
    # Parent has {"api": 100.0}
    # Delegates 20.0 to child
    result = await proxy.syscall("spawn_agent",
        agent_name="researcher",
        budgets={"api": 20.0})
    # Parent now has {"api": 80.0}
    # If child used only 15.0, reclaim 5.0 -> parent has {"api": 85.0}
```

Delegation is atomic: all requested budgets are validated before any are transferred. When a child agent completes or fails, unused budget is reclaimed to the parent. The conservation invariant holds: delegate + reclaim is a closed system.

## Further Reading

- [Architecture Overview](./overview): how capabilities fit in the kernel
- [Budget Management Guide](../guides/budget-management): practical patterns
- [Whitepaper Section 3](../whitepaper/#3-capability-based-security): formal treatment
