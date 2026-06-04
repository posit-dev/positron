# Headless LM Service

A workbench service (`IPositronLMService`) that streams LLM responses directly from the shared process, bypassing the extension host and `vscode.lm` entirely. Ghost cell suggestions are the first consumer.

## Key Links

1. **[posit-dev/ai-provider-bridge](https://github.com/posit-dev/ai-provider-bridge)** -- the extracted provider bridge package (standalone repo)
2. **[assistant#1427](https://github.com/posit-dev/assistant/pull/1427)** -- PR that extracts provider-bridge from the assistant monorepo
3. **[feature/headless-lm-service](https://github.com/posit-dev/positron/tree/feature/headless-lm-service)** -- Positron branch adding IPositronLMService + ghost cell wiring

## Why?

The previous path routed ghost cell requests through the assistant extension via `vscode.lm`:

- Extension host round-trip added latency to every request
- Model selection was opaque -- the extension chose, the workbench had no control
- Credential management was duplicated between extension and workbench
- The provider-bridge library was locked inside the extension monorepo

The headless service solves all four: direct shared-process streaming, explicit provider-priority model selection, workbench-owned credential resolution, and a standalone provider-bridge package.

## API Surface

All public types live in `common/positronLMService.ts`.

```typescript
export type ModelSelection =
  | { tier: 'fast-cheap' }
  | { id: string }
  | { patterns: string[] };

export const FastCheap: ModelSelection = { tier: 'fast-cheap' };

export type StreamFailure = 'no-providers' | 'no-match' | 'auth-required';
export type StreamResult =
  | { stream: AsyncIterable<string>; modelName: string }
  | { failure: StreamFailure };

export interface IAvailableModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
}

export interface IStreamTextParams {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  cancellationToken?: CancellationToken;
  model?: ModelSelection;
}

export interface IPositronLMService {
  readonly _serviceBrand: undefined;
  streamText(params: IStreamTextParams): Promise<StreamResult>;
  readonly availableModels: IAvailableModel[];
  readonly onDidChangeAvailableModels: Event<IAvailableModel[]>;
}
```

**Model selection:**

| `model` value | Resolution | On miss |
|---|---|---|
| `undefined` | Resolve as `{ tier: 'fast-cheap' }` | `{ failure }` |
| `{ tier: 'fast-cheap' }` | Read `languageModels.fastcheap` setting, pattern match | `{ failure: 'no-match' }` |
| `{ id: 'exact-model-id' }` | Exact ID lookup in cache | `{ failure: 'no-match' }` |
| `{ patterns: ['haiku', 'mini'] }` | Substring match, provider-priority order | `{ failure: 'no-match' }` |

**Return value:**
- Success: `{ stream: AsyncIterable<string>, modelName: string }`
- Failure: `{ failure: StreamFailure }` with reason (`'no-providers'`, `'no-match'`, or `'auth-required'`)

**What the service handles for you:**
- **Model selection** -- callers express intent via tier, exact ID, or patterns. The service resolves against its cache using provider priority.
- **Model enumeration** -- `availableModels` and `onDidChangeAvailableModels` for picker UIs.
- **Credentials** -- resolved from Positron's registered authentication providers. Re-resolved fresh before each stream for short-lived tokens.
- **Resilience** -- retries cache warming once if the initial warm failed before returning a failure.
- **IPC and streaming** -- shared-process/remote-server communication, 16ms batching, cancellation propagation, and cleanup are fully encapsulated.

## Usage Example

```typescript
import { hasKey } from '../../../base/common/types.js';
import { IPositronLMService, FastCheap } from '../../services/positronLM/common/positronLMService.js';
import { CancellationToken } from '../../../base/common/cancellation.js';

class MyFeature {
  constructor(
    @IPositronLMService private readonly _lmService: IPositronLMService,
  ) { }

  async summarize(text: string, token: CancellationToken): Promise<string | undefined> {
    const result = await this._lmService.streamText({
      systemPrompt: 'Summarize the following text in one sentence.',
      messages: [{ role: 'user', content: text }],
      cancellationToken: token,
      model: FastCheap, // or omit for same default
    });

    if (hasKey(result, { failure: true })) {
      // No model available -- degrade gracefully
      return undefined;
    }

    let output = '';
    for await (const chunk of result.stream) {
      output += chunk;
    }
    return output;
  }
}
```

For progressive rendering (like ghost cells), emit partial state inside the `for await` loop. See `GhostCellGenerator` for a real example with XML parsing on each chunk.

## Runtime Data Flow

```
Consumer (your code)
  --> AbstractPositronLMService [common/]
        Awaits model cache, resolves ModelSelection, resolves fresh credentials
  --IPC-->  PositronLMNode [shared process or remote server: node/]
              Dispatches to ProviderRegistry, streams chunks back with 16ms batching
  --> ai-provider-bridge [external package]
        Routes to Anthropic, OpenAI, Google, Bedrock, etc. via streaming HTTP APIs
```

No extension host involved. Works on both desktop (Electron shared process) and server-hosted (remote agent) deployments.

## Egress Routing (where the HTTP call originates)

The `node/` implementation is the egress point -- it makes the actual streaming HTTP calls to model providers. It runs in one of two hosts, chosen by the workbench impl's channel selection:

| Deployment | Workbench impl | Channel | `node/` runs in | Egress from |
|---|---|---|---|---|
| Local desktop (no remote) | `electron-browser/` | shared process | local Electron utility process | local machine |
| **Remote SSH (desktop)** | `electron-browser/` | **remote agent** (falls back to shared process if no connection) | **remote server** | **remote server** |
| Web / server-hosted | `browser/` | remote agent | server | server |

**Why remote egress in Remote SSH:** every other Positron LLM feature egresses from the remote host there. Both LM-provider extensions (`positron-assistant`, `copilot`) have a `main` entry point and no explicit `extensionKind`, so they default to `['workspace']` and run in the *remote* extension host (`extensionManifestPropertiesService.ts` -> `nativeExtensionService.ts` host picker). Assistant chat, completions, and the prior `vscode.lm`-based ghost-cell path therefore all egress from the server. Routing this service the same way keeps egress uniform across LLM features and supports air-gapped-remote setups where only the server can reach the model gateway.

**Credentials:** resolved in the renderer and forwarded as channel-call arguments. In Remote SSH they cross to the remote server -- the same secrets that already reach the remote extension host for the assistant, so this is not a new exposure. On plain local desktop they cross only a local IPC boundary.

## Model Selection

The service eagerly caches model lists at activation so most `streamText()` calls resolve instantly from memory:

1. **Warm** (activation) -- resolve all auth sessions, fetch model lists in parallel (10s timeout per provider, failed providers skipped)
2. **Cache** -- `Map<providerId, models[]>`, auto-refreshed when auth sessions change (login/logout)
3. **Resolve** -- dispatch on `ModelSelection` variant:
   - `{ tier }` -- read tier setting, then pattern match
   - `{ id }` -- exact lookup across all cached providers
   - `{ patterns }` -- substring match directly
4. **Pattern match** -- for each pattern, scan providers in `PROVIDER_PRIORITY` order; first substring match wins
5. **Fallback** -- no pattern match: first model from highest-priority provider; empty cache: one retry warm, then failure

**PROVIDER_PRIORITY:** positai > anthropic > openai > gemini > deepseek > copilot > bedrock > openai-compatible

Posit's own gateway is preferred, then direct-to-vendor APIs, then aggregators.

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `languageModels.fastcheap` | string[] | ["haiku", "mini", "flash"] | Preference patterns for the fast-cheap tier |
| `positron.assistant.notebook.ghostCellSuggestions.model` | string[] | ["haiku", "mini"] | Ghost cell model override (forwarded as `{ patterns }`) |
| `authentication.aws.credentials.AWS_REGION` | string | "us-east-1" | AWS region for Bedrock credential construction |

## File Map

```
services/positronLM/
  common/positronLMService.ts        -- interface + public types
  common/positronLMServiceImpl.ts    -- abstract base class (cache, matching, credentials)
  common/positronLM.contribution.ts  -- tier settings registration
  common/streamingTagLexer.ts        -- streaming XML parser
  browser/positronLMService.ts       -- web/remote impl (channel via remote agent)
  electron-browser/positronLMService.ts -- desktop impl (channel via shared process)
  node/positronLMService.ts          -- shared process impl (ProviderRegistry, streaming)
  test/common/positronLMServiceImpl.vitest.ts
  test/common/streamingTagLexer.vitest.ts

contrib/positronNotebook/
  common/notebookLMContext.ts        -- shared context builder
  test/common/notebookLMContext.vitest.ts
  browser/contrib/ghostCell/generation/generator.ts
  browser/contrib/ghostCell/controller.ts

Registration:
  workbench.desktop.main.ts          -- electron-browser/ singleton
  workbench.web.main.ts              -- browser/ singleton
  workbench.common.main.ts           -- tier settings contribution
  sharedProcessMain.ts               -- IPC channel registration
```

## Adding a New Provider

1. Register the provider in [ai-provider-bridge](https://github.com/posit-dev/ai-provider-bridge). This gives it a `providerId` and handles API-specific streaming.
2. Add an entry to `AUTH_PROVIDER_MAP` in `common/positronLMServiceImpl.ts` mapping your auth provider ID to the bridge's `providerId` and credential type (`apikey`, `oauth`, or `aws-credentials`).
3. Add the `providerId` to `PROVIDER_PRIORITY` (also in `common/positronLMServiceImpl.ts`) at the appropriate position.
4. Ensure the authentication provider is registered in Positron so `getSessions()` can find credentials.

Everything else (cache warming, model fetching, pattern matching, streaming) works generically from the map entries.

## Adding a New Consumer Feature

1. Add `@IPositronLMService private readonly _lmService: IPositronLMService` to your constructor.
2. Call `this._lmService.streamText({ systemPrompt, messages, cancellationToken, model })`.
3. Handle the `{ failure }` case gracefully in your UI.
4. Iterate the stream. For progressive UI, update state on each chunk. For batch use, collect into a string.

**Model selection options:**
- Omit `model` or pass `FastCheap` for the default fast/cheap tier
- Pass `{ patterns: [...] }` to forward user-configured preference strings
- Pass `{ id: 'exact-model-id' }` for a pinned model (from a picker)

**For picker UIs:** subscribe to `onDidChangeAvailableModels` to populate a model dropdown. When the user pins a model, store the ID in your feature's own config and pass `{ id }` on subsequent calls.

No registration, provider configuration, or credential management needed -- the service is a singleton registered at workbench startup.
