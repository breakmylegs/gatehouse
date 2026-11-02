# ADR 0011: Which providers first, local models, and how a provider is shown

Status: Accepted for a local runtime, 1 Nov 2026 (owner: "do every single thing still on the list. You choose the best option"); built in Phase 83. Azure OpenAI and other hosted models: through an organisation gateway on this computer (ADR 0010, decided 2 Nov), built in Phase 86.

## Context

The research ranked Azure OpenAI (Responses API, Entra ID sign-in) first, then a local runtime, then Gemini on Vertex AI and xAI after legal review. Showing which provider a session uses must not imitate any vendor (invariant 16).

## What was checked (1 Nov)

- **Ollama CVE-2026-7482** ("Bleeding Llama", a heap out-of-bounds read in the GGUF loader, CVSS 9.1): fixed in 0.17.1 (GitHub advisory GHSA-x8qc-fggm-mpqg). The research's further floor of 0.34.2, for a pull API SSRF, comes from a third-party article only and is not confirmed.
- Azure and xAI data terms: see ADR 0010.

## Decision

- **First hosted provider: Azure OpenAI**, proposed, waiting on ADR 0010 (credentials) and on which Azure subscription and deployment type (Data Zone or regional) the owner can use.
- **A local runtime needs no credential**, so it is the first provider that could be built without ADR 0010: Ollama (at least 0.17.1, and the newest release when built) or llama.cpp's server, bound to 127.0.0.1 only, its own updater off, models only from a list of allowed hashes, a stricter Approver profile for small models. It needs IT to package the runtime; Codehouse will not download one itself.
- **Provider identity:** a neutral Codehouse chip with the provider's name as text ("Azure OpenAI · model"), a Codehouse palette colour and a Codehouse shape; a second chip for where the data goes ("Local", "Hosted, nothing kept", "Hosted, kept 30 days"). No vendor logo, colour or font.

## Consequences

- The next build step for multi-provider is the owner's: choosing a local runtime IT can package, or accepting ADR 0010 and naming an Azure deployment.

## Constraint check

Fits invariants 9, 14 and 16 as written. No provider ships without passing the conformance suite (ADR 0008).
