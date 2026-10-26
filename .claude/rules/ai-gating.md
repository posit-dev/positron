# Gating AI features on `ai.enabled`

`ai.enabled` is the single main switch for all of Positron's AI features (Next Edit Suggestions, notebook AI, console Fix/Explain, etc.). Anything that calls a model, suggests completions, or surfaces AI actions MUST be gated on it from the start, so the user (or a Posit Workbench admin) can turn everything off in one place.

## The setting

`ai.enabled` is Positron-owned, defaults to `true`, and is `WINDOW`-scoped. It's declared in [positronAIConfiguration.ts](../../src/vs/workbench/contrib/positronAssistant/common/positronAIConfiguration.ts), which exports the key as `AI_ENABLED_KEY`. Import that constant; don't hard-code the `'ai.enabled'` string.

The key string is the contract. `ai.enabled` sits above each feature's own preconditions, so check it in addition to whatever feature-specific gates already exist (a feature setting, "has chat models", notebook mode, etc.) rather than replacing them. The feature shows only when `ai.enabled` and all its own conditions are true.

## How to read it

Pick the form that matches where the code runs.

**Action `when` clause / precondition** (registering an action or menu item):

```ts
import { AI_ENABLED_KEY } from '.../positronAssistant/common/positronAIConfiguration.js';

precondition: ContextKeyExpr.has(`config.${AI_ENABLED_KEY}`),
```

See [commitMessageAction.ts](../../src/vs/workbench/contrib/positronAssistant/browser/commitMessageAction.ts).

**Service / non-React code**:

```ts
if (this._configurationService.getValue<boolean>(AI_ENABLED_KEY) === true) { ... }
```

See [errorActionHandlerService.ts](../../src/vs/workbench/contrib/positronAssistant/browser/errorActionHandlerService.ts).

**React component**:

```ts
const aiEnabled = usePositronConfiguration<boolean>(AI_ENABLED_KEY);
```

**Error Fix/Explain actions** (a surface that sends an error to an AI assistant): don't read `ai.enabled` yourself. Show the actions only while the active error action handler is defined, using `useActiveErrorActionHandler()` in React or `IErrorActionHandlerService.activeHandler` elsewhere, and send the error with `IErrorActionHandlerService.ask`. The service applies the `ai.enabled` gate to both. Keep any surface-specific gate (a console setting, notebook mode, etc.) alongside it. See [errorAction.ts](../../src/vs/workbench/contrib/positronAssistant/common/errorAction.ts).

## Things to get right

- **Read the value live, don't cache it at construction.** `ai.enabled` toggles without a window reload, so read `getValue` each time (or react to `onDidChangeConfiguration` / use the React hook). A value captured once in a constructor goes stale.
- **Read the value, not a policy name.** In Posit Workbench `ai.enabled` is enforced through the `POSITRON_ENFORCED_SETTINGS` env var, not the VS Code policy block. `getValue` and the context key already reflect the enforced value; checking a policy name would miss it.
- **Default is `true`.** A fresh profile with nothing set reads as enabled. Compare against `=== true` to show the feature, or `=== false` to hide it, so the on and off cases are spelled out and an undefined value can't slip through as truthy.
- **Extension code reads it too.** If the feature lives in an extension (e.g. `next-edit-suggestions`), gate on the same `ai.enabled` key via the extension's configuration API.

## Companion extensions

Posit Assistant (separate repo, `posit-dev/assistant`) reads `ai.enabled` on its own and combines it with `assistant.enabled`, so the chat is on only when both are true. If your feature spans both Positron core and a companion extension, gate on both sides; don't rely on one to cover the other.
