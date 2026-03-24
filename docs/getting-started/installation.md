---
sidebar_position: 1
---

# Installation

## Requirements

- Python 3.11 or later
- [uv](https://docs.astral.sh/uv/) (recommended) or pip

## Install with uv

```bash
uv add castor
```

## Install with pip

```bash
pip install castor
```

## Optional Extras

Castor provides optional dependency groups for specific use cases:

```bash
# Observability (OpenTelemetry)
uv add "castor[observability]"

# smolagents integration
uv add "castor[smolagents]"

# pydantic-ai integration
uv add "castor[pydantic_ai]"

# Interactive demos (Rich + LiteLLM)
uv add "castor[demo]"
```

## Development Setup

To work on Castor itself:

```bash
git clone https://github.com/substratum-labs/castor.git
cd castor
uv sync          # Install all dependencies
uv run pytest    # Run the test suite (169 tests)
uv run ruff check src/   # Lint
uv run ruff format src/  # Format
```

## Verify Installation

```python
import castor
print(castor.__version__)  # 0.4.0
```

Or from the command line:

```bash
castor --help
```
