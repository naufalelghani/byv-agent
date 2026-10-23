# P5.1 — API-First Provider Configuration

**Status:** Implementation on review branch. Configuration preflight only; live provider and Claude Code runtime verification are separate requirements.

## Goal

BYV Agent is intended to run from Claude Code CLI using explicit API credentials or a compatible gateway, without requiring a claude.ai login or subscription. BYV does not own the provider credential and does not store its value.

## API-only preflight

From the repository root, run:

```sh
node scripts/byv-runtime-doctor.mjs --api-only
node scripts/byv-runtime-doctor.mjs --api-only --json
```

The doctor only inspects environment variables. It does not contact the endpoint and cannot prove that the active Claude Code session used those credentials. Confirm the active credential source with the Claude Code `/status` command, then make a real model request.

The doctor reports whether credentials are present, not their values. Never paste real keys into task content or commit them into repository settings.

## Mode 1 — Direct API

For the direct Anthropic API, configure `ANTHROPIC_API_KEY` in the shell before launching Claude Code. API billing/account rules are set by the API provider; this mode does not require a Claude.ai subscription session.

PowerShell (current terminal only):

```powershell
$env:ANTHROPIC_API_KEY = Read-Host "Paste provider API key"
claude --plugin-dir .
```

Avoid placing a real key directly in command history. The prompt above stores the value only in the current process environment and still leaves it in that shell's environment for launched processes. Clear it after use:

```powershell
Remove-Item Env:ANTHROPIC_API_KEY
```

For an external gateway, use the authentication variable the gateway expects rather than guessing the header name. Claude Code sends `ANTHROPIC_AUTH_TOKEN` as an Authorization Bearer header and `ANTHROPIC_API_KEY` as an `x-api-key` header. With a saved login present, `ANTHROPIC_AUTH_TOKEN` takes precedence immediately; `ANTHROPIC_API_KEY` may require a one-time interactive approval before it takes over. Run `/status` to confirm the active source. If you want to remove the saved account credential entirely from this CLI profile, use `/logout` after confirming you can still authenticate with your intended API credential.

## Mode 2 — Third-party Anthropic Messages-compatible endpoint

A gateway must accept the Anthropic Messages request protocol. Configure the endpoint, credential, and explicit model ID before launching Claude Code:

```powershell
$env:ANTHROPIC_BASE_URL = "https://your-gateway.example/anthropic"
$env:ANTHROPIC_AUTH_TOKEN = Read-Host "Gateway bearer token"
$env:ANTHROPIC_MODEL = "provider-model-id"
$env:BYV_PROVIDER_PROTOCOL = "anthropic-messages"
$env:BYV_PROVIDER_PROFILE_ID = "my-gateway"
node scripts/byv-runtime-doctor.mjs --api-only
claude --plugin-dir .
```

Use `ANTHROPIC_AUTH_TOKEN` when the endpoint expects an Authorization Bearer token; use `ANTHROPIC_API_KEY` when it expects an API-key header. A gateway may have provider-specific rules; follow its documentation.

If the gateway accepts an OpenAI-compatible or other protocol, it needs an explicit translation adapter that handles Anthropic Messages requests, streaming events, tool calls, stop reasons, and error responses. Set `BYV_PROVIDER_PROTOCOL=translated-anthropic-messages` only for such an adapter. Declaring a protocol is not proof that the gateway is compatible: the runtime doctor reports third-party endpoints as unverified.

The base URL must be HTTPS. Plain HTTP is allowed only for loopback development endpoints. URLs may not contain embedded credentials, query parameters, or fragments.

## Provider profile metadata

- Schema: `config/provider-profiles.schema.json`
- Safe example: `config/provider-profiles.example.json`

These files contain environment-variable names and compatibility status, never credential values. Keep untested capabilities marked `unverified`. Provider/model compatibility is assessed through the later P5.4 integration suite.

## Compatibility labels

- **Configuration preflight passed:** the required explicit environment variables exist. No request has been made.
- **Endpoint reachable:** a real API request succeeded.
- **Messages-compatible:** protocol tests for request, streaming, tool use, error handling, and stop reasons passed.
- **Agentic-verified:** the target model completed multi-turn tool use and the selected Agent Teams/fallback workflow passed in a real Claude Code smoke test.

Do not infer the latter labels from a successful Node.js unit-test run.

## Limitations and honest support statement

Claude Code documents gateway routing in terms of the Anthropic Messages API. Anthropic's docs currently state that routing Claude Code to non-Claude models through gateways is not supported by Anthropic. BYV's third-party provider path is therefore best-effort and must be verified against each provider/model. The API-only goal means avoiding claude.ai account login; it does not mean every arbitrary model is automatically compatible.

Environment variables are read when Claude Code starts; restart the session after changing configuration. Verify the active auth source using `/status`. The BYV doctor never claims that an existing saved login is absent or that the live session's credential source is verified.
