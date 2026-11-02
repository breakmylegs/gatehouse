# ADR 0010: Credentials for a loop provider

Status: **Decided, 2 Nov 2026: option 4 below.** The owner delegated the decision ("anything you are waiting on for my decision, make the best decision for the app"). Option 4 changes no invariant, so it needs no security sign-off on one; security should still review any gateway the organisation deploys. Built in Phase 86.

## Context

Invariant 6 says Codehouse never reads, copies, logs or transmits a credential, and sign-in only happens through Anthropic's own flow in the unmodified Claude Code binary. For Claude that holds: Claude Code signs in and calls Anthropic, and Codehouse never sees a token. A loop provider is different: Codehouse calls the model's API, so it must present a credential on every call. The research (its ADR-003) proposed rewording the invariant.

## What was checked (1 Nov)

- **Microsoft's Windows broker from Node** (learn.microsoft.com, MSAL Node brokering, updated 23 Oct 2026): `@azure/msal-node` with `NativeBrokerPlugin` from `@azure/msal-node-extensions` gets tokens through Web Account Manager. "Refresh tokens are bound to the device on which they are acquired and are not accessible by `msal-node` or the application." Proof-of-possession access tokens are supported only through the broker. "`msal-node` will not fall back to the non-brokered flow in the event of a failure." The access token itself still reaches Codehouse's process, to be sent with each request.
- `@azure/msal-node-extensions` reaches the broker through a native module (known from the package, not stated on that page; confirm against the version used). This repository avoids native addons (CLAUDE.md conventions), so using it is itself a decision to make.
- **xAI** (docs.x.ai security FAQ, 1 Nov): requests and responses are kept 30 days; "every API response includes an `x-zero-data-retention` header set to "true" or "false""; zero data retention can now be switched on by a team admin in the console where it is offered (the research said enterprise only; that has changed).
- **Azure OpenAI**: the 30-day abuse-monitoring retention the research gave is not stated on Microsoft's current pages; only answers on Microsoft Q&A give it. Modified abuse monitoring is a limited-access application, not a setting.

## Options

1. Refuse loop providers that need a credential: only local runtimes (no credential) could ever be added.
2. Reword invariant 6 as the research proposes: "Codehouse never persists, logs or displays a credential, never places one in environment variables, and transmits it only to the vendor endpoint it belongs to, through an OS broker or DPAPI-sealed store."
3. As option 2, but only through an OS broker (WAM), with access tokens in memory only, proof-of-possession where offered, and no API keys at all.

4. **Keep invariant 6 as written.** A hosted provider is reached only through a gateway on this computer that the organisation runs (LiteLLM, an Azure API Management self-hosted gateway, an IT agent) and that holds the provider's credentials itself. Codehouse talks to it like any OpenAI-compatible runtime on 127.0.0.1 and sends no key, token or password; a runtime's settings refuse one.

## Decision

Option 4. It unlocks hosted models (Azure OpenAI first) without Codehouse ever touching a credential, keeps the native-module question away, and puts the credential where the organisation already manages it. The window says where a chat's words go ("Azure OpenAI through your gateway") and what that provider keeps, as you record it. Options 2 and 3 stay on file should a gateway not be possible; either would need security's sign-off.

## Earlier recommendation (superseded by the decision above)

Option 3 if any hosted provider is wanted; it is the closest to the invariant as it stands, since refresh tokens never reach Codehouse. It still changes invariant 6, so it needs security's sign-off, and the native module needs a decision of its own. Until then: option 1 in effect.

## Constraint check

Proposed only. Invariant 6 is unchanged and holds.
