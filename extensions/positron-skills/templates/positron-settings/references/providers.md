# Positron AI provider status

Finding out which AI language model providers the user has set up: enabled or
disabled in the provider catalog, signed in or not, and healthy or failing.
See [SKILL.md]({{skill_dir}}/SKILL.md) for how to call commands, how to handle
failures, and how to read a truncated result.

The **Returns** entry below is generated from the running build's command
metadata, so it always matches this Positron. The surrounding guidance is
hand-written.

## What "enabled" means here

Users say "enabled" to mean several different facts. The payload keeps them
separate, and so should the answer:

- **Enabled**: the provider catalog allows this provider (`enabled: true`).
  Administrator enforcement is already folded in.
- **Signed in** (`auth: 'signed-in'`): a credential resolves right now.
- **Healthy**: no `problem` field. `problem` means the provider itself
  reported an issue with its configuration or credentials, whatever its
  sign-in state, and is worth calling out even when the user did not ask.
- **Usable**: all three. This is usually what the user is really asking. A
  provider that is enabled but `not-signed-in` with no `problem` is offered,
  not set up.

## Anti-patterns

Each row below is a move that was actually observed going wrong. Do not remove
a row without checking its reason still cannot happen.

| Do not | Because (observed) |
|---|---|
| point the user at `~/.posit/assistant/settings.json` for provider configuration | Observed, and factually wrong: that file is Posit Assistant's own settings and holds no provider config. Providers live in the provider catalog (providers.json), and even that file is not the resolved answer -- this command is. |
| read providers.json, or any file, to answer which providers are enabled | The file's location differs by deployment, administrator-enforced layers overlay it, and no file carries sign-in state. The payload reports the resolved verdict with all of that folded in. |
| send the user to the model picker or the Configure Providers UI instead of answering | Observed: "finding your configured providers is easy:" followed by click-path directions, in place of the answer. Query, answer, and mention the UI only as the place to change things. |
| say "I can't directly inspect your settings from here" | Observed, and false once this skill is loaded. |
| report a provider as signed out because its entry has no `auth` field | Absence means unknown, not signed out. Say sign-in state is unknown for that provider. |
| guess at a customized base URL or connection value | `customizedConnection` carries field names only, deliberately. If the user needs the value, direct them to open providers.json (the "Open AI Provider Settings (JSON)" command), never invent one. |

## Reading provider status

### `positronAssistant.getProviderStatus`

Reports every provider this window knows, with the catalog's enablement
verdict and live sign-in state -- the same state the Configure Language Model
Providers UI renders. No arguments; the payload is small (one entry per
provider) and needs no filtering.

{{command:positronAssistant.getProviderStatus}}

**Worked flow -- "which providers do I have enabled / set up?":**

1. Call `positronAssistant.getProviderStatus`.
2. Lead with the usable providers: `enabled: true`, `auth: 'signed-in'`, and
   no `problem`, named by `displayName` (fall back to `id`). An entry with
   `completionsOnly: true` serves inline completions, not chat, so note it
   separately from the chat answer -- but decide that from the flag only.
   Treat every other entry as chat-capable; never demote a provider by name.
3. Call out any entry carrying `problem` even when the user did not ask: the
   provider reported an issue with its configuration or credentials, and
   `problem` is its own words. Read it together with `auth`: `not-signed-in`
   with a problem like "Authentication expired" means re-authenticating (via
   the Configure Language Model Providers UI) is the likely fix; `signed-in`
   with a problem means the credential works and the issue is configuration,
   so do not send the user to re-authenticate. The list is already ordered so
   problem entries come first.
4. Distinguish the rest honestly: enabled but `not-signed-in` means no
   credential resolves (never set up, or signed out); `enabled: false` means
   turned off in the catalog, by the user or by an administrator -- the
   payload cannot say which.
5. Check the honesty fields before asserting anything:
   - `authStateUnavailable: true` means no sign-in state exists in this window
     at all. Report which providers are enabled and say sign-in state is
     unavailable; do not call anything signed out.
   - A `catalogStatus` other than `'ready'` means the provider catalog could
     not be read (or had not loaded yet). Entries then omit `enabled`
     entirely: report sign-in state, say enablement is unknown, and never
     read a missing `enabled` as disabled.
6. `maturity` ('preview' or 'experimental') and `custom` (a provider the user
   defined themselves) are worth a parenthetical when present, not a section.

**Worked flow -- "why isn't provider X working?":**

1. Find X's entry. `enabled: false` or a `problem` field is usually the whole
   answer -- and `problem` with `not-signed-in` points at credentials, while
   `problem` with `signed-in` points at configuration.
2. If X is enabled, signed in, and healthy but chat still fails, the cause is
   not provider status; check the AI feature switches in
   [configuration.md]({{skill_dir}}/references/configuration.md) (`ai.enabled`
   and `assistant.enabled` both gate Posit Assistant).
3. `customizedConnection` naming `baseUrl` or an `aws.*`/`snowflake.*` field
   is a lead worth mentioning: it means the user or an administrator changed
   that field from this build's default (a stock install reports none), and a
   customized endpoint that stopped resolving looks like an auth failure. The
   payload never carries the value; have the user check providers.json.

## When this payload disagrees with another view

An extension (including the Posit Assistant) may resolve providers.json on its
own and reach a different list -- a stale environment snapshot, a different
profile. This command's payload is the authoritative view for enablement and
usability, because only the Positron side sees both the resolved catalog and
the live credential state. Do not blend the two views; report this payload and
note the discrepancy if one is visible.

## What this command does not report

- **Models.** It reports providers, not the models each one serves. The model
  picker (and the Assistant itself) already knows the available models; do not
  present a provider list as a model list.
- **Connection values.** Field names only, never URLs, hosts, accounts, or
  header values.
- **Who disabled a provider.** `enabled: false` does not distinguish the user
  from an administrator.
