# ADR: Playwright MCP Patterns For agent-memory

## Status

Accepted

## Context

`agent-memory` started with a hand-rolled JSON-RPC stdio implementation.
That was enough to expose MCP tools, but it kept protocol handling, transport handling, tool registration, and session state tightly coupled in one file.

`playwright-mcp` demonstrates a cleaner split:

1. SDK-backed MCP server instead of manual protocol framing
2. per-session backend objects instead of global mutable state
3. declarative tool schemas plus annotations
4. transport abstraction across stdio and Streamable HTTP
5. reusable result, error, and progress builders

## Decision

`agent-memory` adopts the same five patterns:

- use `@modelcontextprotocol/sdk` as the MCP protocol/runtime layer
- resolve repository root through a per-session backend, preferring client roots over process cwd
- register tools through a shared declarative registry backed by `zod`
- support both stdio and opt-in HTTP transports from the same MCP surface
- standardize tool results as text content plus versioned `structuredContent`, with typed errors and progress notifications

## Consequences

- MCP behavior is easier to test with the official SDK client
- HTTP and multi-session support no longer require a parallel server implementation
- tool metadata becomes richer and more consistent for clients
- result envelopes are now opinionated and versioned, which is a breaking change for callers that depended on the old raw `structuredContent` shape
