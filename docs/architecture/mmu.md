---
sidebar_position: 5
---

# Context Window Management (MMU)

The MMU subsystem prevents LLM context window overflow: the "amnesia" problem where long-running agents forget critical instructions because older messages are pushed out of the context window.

## The Agentic MMU

Just as an operating system's Memory Management Unit (MMU) manages physical memory with virtual addressing, Castor's MMU manages the LLM's context window with token-aware eviction:

| OS MMU | Castor MMU |
|---|---|
| Physical memory pages | Context window tokens |
| Page table | Token counter |
| Page fault | Context overflow |
| Page eviction (LRU) | Message eviction (FIFO) |
| Swap space | Semantic memory store |
| Pinned pages | Pinned messages (system prompts) |

## How It Works

### Token Counting

The MMU monitors the token count of the current message history. A configurable **watermark threshold** triggers eviction before the context window is fully consumed.

```python
mmu = MMU(
    max_tokens=128_000,
    watermark=0.85,  # trigger eviction at 85% capacity
    token_counter=tiktoken_counter,
)
```

### Pinned Messages

System prompts, safety instructions, and other critical messages can be **pinned**; they are never evicted:

```python
mmu.pin(system_prompt_message)
```

Pinned messages stay in the context window regardless of token pressure.

### FIFO Eviction

When the watermark is reached, the MMU evicts the **oldest unpinned messages** first. Evicted messages are stored in a semantic memory backend for potential retrieval.

The eviction is routed through the SyscallProxy as a kernel tool (`sys_kernel_page_out`) for replay safety. During replay, the eviction is skipped (its effects are already baked into the checkpoint).

### Semantic Page-In

Agents can retrieve evicted memories on demand using the `search_memory` tool:

```python
async def agent(proxy: SyscallProxy):
    # Context might have evicted earlier conversation
    memories = await proxy.search_memory(query="user's budget constraints")
    # Use retrieved context to make informed decisions
```

The page-in mechanism uses a `SemanticMemoryDriver` abstraction (ABC). The default `InMemoryDriver` uses substring search for testing; production deployments can plug in vector search backends (Qdrant, Pinecone, local embeddings).

## Further Reading

- [Architecture Overview](./overview): how MMU fits in the kernel
- [Whitepaper Section 7](../whitepaper/#7-context-window-management-mmu): formal treatment
