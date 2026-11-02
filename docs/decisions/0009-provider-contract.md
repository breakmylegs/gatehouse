# ADR 0009: The provider contract, hosted tools and vendor-held state

Status: Accepted for the groundwork, 1 Nov 2026 (owner: pick the best options). Built in Phase 81.

## Context

Providers differ in streaming, resume, fork, MCP, usage reporting and where data goes. Some offer tools that run on the vendor's side (hosted web search, code execution, hosted MCP), and some keep the conversation on their servers.

## Decision

- **Capability flags, not a lowest common denominator.** Each adapter declares what it can do (`ProviderCapabilities` in `apps/host/src/providers/types.ts`); the window will hide what a provider cannot do. A conformance check compares a declaration with behaviour where it can.
- **No bypass in the types.** A mode is one of Codehouse's four (Manual, Plan, Accept edits, Auto, invariant 3). A wrap adapter lists the vendor settings it runs with, and the registry refuses one that would approve calls by itself (`bypassPermissions`, `dontAsk`, an approval policy of `never`, YOLO, auto- or always-approve, skip-permissions). A loop adapter runs no vendor agent and may list none.
- **Vendor-hosted tools are never switched on.** They run outside Codehouse's gate. Search and fetch are Codehouse tools or absent (`webSearch: "app-tool" | "none"`). Codehouse's executor does not run a web search yet: it needs a search service with acceptable terms (research S-12), which is the owner's choice.
- **Codehouse holds the conversation** for loop providers (`store=false` or the vendor's equivalent), so nothing depends on a vendor keeping it.
- **The setting is `providers.multi.enabled`**, per computer, in the settings file, off when absent. Older versions keep it without using it.

## Consequences

- Larger requests for loop providers (the whole conversation each time), partly offset by prompt caching.
- Search quality for loop providers depends on the search service chosen later.

## Constraint check

Fits. Invariant 3 is enforced in the registry as well as in each session's options.
