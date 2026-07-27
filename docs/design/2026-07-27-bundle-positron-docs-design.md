# Bundling Positron docs on disk: design spec

Date: 2026-07-27

Status: Approved for implementation

Author: Marie Idleman (with Claude)

Supersedes: [2026-07-24 spike](./2026-07-24-positron-bundle-docs-spike.md) (analysis of options A/B/C)

## Goal

Let Positron's AI assistant read product documentation from disk instead of fetching it from
`https://positron.posit.co`. Reading from disk cuts token usage, removes per-call WebFetch approval
prompts, and works offline once the docs are present.

Both Positron Desktop and Posit Workbench are in scope, served by a single mechanism.

## Decisions carried in from the spike

The spike laid out three ways to get docs on disk. **Option A (runtime download plus cache)** was
chosen: no docs ship in the installer, and the app downloads a slim bundle from the CDN.

Further decisions made during design:

| Decision | Choice |
|---|---|
| Spec scope | Step 1 (positron-website slim bundle) and Step 2 (Positron download/cache/advertise). Step 3 (the assistant read path) is out of scope, covered by a handover contract. |
| Consumers | The AI assistant only. Core UI keeps using web URLs. |
| Version policy | Release builds fetch their exact version; dailies fetch the newest published bundle. A release build whose exact bundle is not yet published falls back to the newest published bundle and keeps converging to exact. |
| Trigger | On launch (gated on `ai.enabled`), on `ai.enabled` flipping true, and joined by a first-need call. |
| Placement | Extension-host-resident `positron.docs` API, with all logic in a host-agnostic module behind injected ports. |
| URL rewriting | Done in the website pipeline, enforced by a CI guard. |

## Why the extension host

The download has to run where the extension host runs, because the extension host is the only
consumer.

A browser/renderer-layer service cannot work. In Workbench the extension host is a Node process on
the server (`src/vs/server/node/extensionHostConnection.ts:44`), while browser-layer `IFileService`
writes to IndexedDB in the user's browser. The assistant could never read that. `base/node/zip.ts`
is node-layer only, so unzipping in the renderer is not possible either.

Two placements remained: an extension-host-resident API, or a `platform/` node service registered in
both `sharedProcessMain.ts` and `serverServices.ts` with an IPC channel and a main-thread bridge.

The extension host wins on three counts:

- **Correctness in remote windows.** With SSH or dev containers the extension host runs on the remote
  host. An extHost-resident download lands there, co-located with its consumer. A platform service
  would have two instances (local shared process plus remote server) and would need a rule for which
  one serves the extension host versus core UI.
- **Merge surface.** One upstream file changes by one line, versus three or four for the platform
  route. Positron's upstream-compatibility guidance favours the smaller surface.
- **The "core might want this later" argument is weaker than it looks.** Help, the welcome page, and
  release notes render HTML. The slim bundle is Markdown with no chrome, so core UI would need the
  full 67MB bundle or a Markdown renderer regardless of where the download lives.

The mitigation for the one real cost (core cannot consume this without an inverted dependency on the
extension host) is the seam: all logic lives in a host-agnostic `platform/` module behind injected
ports, so re-hosting it in a node service later is a second thin wiring rather than a rewrite. That
is also what makes it unit-testable.

The genuine risk of this placement is that a slow or hung download must never be awaited on an
extension-activation path. That is a discipline requirement with a test asserting it.

## Step 1: the slim bundle (posit-dev/positron-website)

One new step in `release-docs-bundles.yml`, run per profile after the existing render, alongside (not
replacing) the current 67MB bundles.

### Contents

From `_site` and `_site-workbench`:

- `llms.txt`, rewritten to bundle-relative paths (the `https://positron.posit.co/` prefix stripped)
- `**/*.llms.md`, preserving directory structure (`release-notes/...`)
- a generated `bundle.json`

```json
{
  "schema": 1,
  "profile": "positron",
  "version": "2026.05.0-179",
  "generated": "2026-07-24T18:02:11Z",
  "docsBaseUrl": "https://positron.posit.co/",
  "fileCount": 90
}
```

`schema` lets the format evolve without consumers guessing. **Schema version 1 is defined as
including "`llms.txt` uses bundle-relative paths"**, so Positron keys off the version rather than
sniffing the file. `version` means the app can record what it actually received even when it fetched
a `latest` alias. `docsBaseUrl` lets the assistant cite a real web link for a page it read from disk.

Roughly 655KB uncompressed across ~90 files, about 150KB zipped.

### Where the URL rewriting happens, and why

The rewrite happens in the pipeline rather than at extract time in Positron or at read time in the
assistant. The slim bundle is a derived artifact by definition, so rewriting paths in it is not
divergence from the site (the site's own `llms.txt` is untouched), and it is the only option where
the thing on disk means what it says without a decoder ring. It also keeps the transform out of the
per-read path and makes the bundle usable as-is by any other consumer.

The risk is that the rewrite rests on an unverified assumption: that only `llms.txt` carries site
links and the `.llms.md` pages carry none. If a Quarto upgrade or a new doc pattern breaks that, the
assistant would silently start emitting `positron.posit.co` links from supposedly local docs.

**So the pipeline must prove the rewrite happened.** After rewriting, fail the workflow if any
bundled file still matches `positron.posit.co`. That converts the assumption into an enforced
invariant at the cost of one `grep`, and a docs release breaks loudly rather than degrading
silently.

### Artifacts

Uploaded to the existing `docs/` prefix under the `releases` channel:

| Object | Mutability | `Cache-Control` |
|---|---|---|
| `positron-llms-<version>.zip` | immutable | long `max-age` |
| `positron-workbench-llms-<version>.zip` | immutable | long `max-age` |
| `positron-llms-latest.zip` | moves each release | `no-cache` |
| `positron-workbench-llms-latest.zip` | moves each release | `no-cache` |

`no-cache` on the aliases is what makes the ETag check meaningful: CloudFront revalidates with the
origin instead of serving a stale edge copy, so a `304` genuinely means unchanged.

CloudFront invalidation covers only the two `latest` keys. The versioned objects are new keys and
need none.

**Channel note.** Docs bundles are published only under `releases/docs/`, since the website publishes
at release time. Dailies read from that same prefix via the `latest` alias; they do not look under
`dailies/docs/`.

This reuses the existing render, S3 upload, and invalidation, keeping it to roughly 5-10 lines plus
the guard, with two new CDN objects per profile per release.

### Website-side validation

The CI guard is the test:

- no bundled file matches `positron.posit.co`
- the zip contains `llms.txt` and `bundle.json`
- the extracted file count matches `bundle.json`'s `fileCount`

Any failure fails the workflow.

## Step 2: Positron

### Module layout

The seam lives in `platform/`, importable from anywhere, with no DI and no node imports.

**`src/vs/platform/positronDocs/common/`** (host-agnostic)

1. **`positronDocsBundle.ts`** - pure types and functions:
   - `IDocsBundleManifest` (the `bundle.json` shape)
   - `IDocsCacheState` (persisted state, see below)
   - `resolveBundleRequest({ quality, positronVersion, positronBuildNumber, profile, baseUrl })`
     returning the URL plus whether it is the `exact` or `latest` form
   - `parseManifest()`, which rejects any `schema !== 1`

2. **`positronDocsPorts.ts`** - three narrow ports rather than one wide interface, so each test fake
   is three to six methods:
   - `IDocsHttpClient` - `get(url, { etag? })` and `head(url)`, returning `{ status, etag?, body? }`
   - `IDocsFileStore` - exists, read, write, mkdir, rename, delete, readdir
   - `IDocsArchive` - `extract(zip, target)`

3. **`positronDocsCache.ts`** - `class PositronDocsCache`, the orchestrator. Takes the three ports
   plus a logger and a clock. `ensure(request)` runs the whole state machine: read state, decide,
   download to temp, validate, extract to staging, atomic swap, persist state, prune. It holds an
   in-flight promise so concurrent callers join rather than race, which is what implements the
   await-in-flight behaviour. All the interesting logic is here, with no host dependency.

**Extension-host wiring (thin)**

4. **`src/vs/workbench/api/common/positron/extHostDocs.ts`** - the `IExtHostDocs` decorator and
   interface, plus `ExtHostDocsUnsupported` (returns `undefined`) for the web-worker host.

5. **`src/vs/workbench/api/node/positron/extHostDocsNode.ts`** - `NodeExtHostDocs`. Injects
   `IExtHostInitDataService`, `IExtHostConfiguration`, and `ILogService`. Constructs the three ports:
   node `https` for HTTP (already proxy-patched in the extension host, so enterprise proxies work
   without extra code), `pfs` for files, and `extract()` from `base/node/zip.js` for the archive.
   Derives its inputs (below), owns the triggers, and delegates to the cache.

Registered `Eager` in `extHost.node.services.ts` so the launch trigger has something to fire from,
but the constructor only installs a `RunOnceScheduler` and the `ai.enabled` listener. It never
touches the network inline. That is the discipline that keeps a slow download off the activation
path.

`ExtHostDocsUnsupported` is registered in `extHost.worker.services.ts`.

### Reading product.json from the extension host

`bootstrap-esm.ts:39` sets `globalThis._VSCODE_PRODUCT_JSON`, and both
`api/common/extHostMcp.ts:20` and `api/node/extensionHostProcess.ts:21` already import the `product`
default export from `platform/product/common/product.js`. So the CDN base can live in `product.json`
and be read directly from the extension host.

### The public API

One function on a new `positron.docs` namespace. Like `positron.paths`, it needs no protocol shapes,
no `MainThread` customer, and no `extensionHost.contribution.ts` edit.

```ts
namespace docs {
    export interface LocalDocs {
        /** Absolute path of the extracted bundle root, on the extension host's filesystem. */
        readonly path: string;
        /** Bundle format version. Currently 1. */
        readonly schema: number;
        /** Docs version this bundle was generated from, e.g. '2026.05.0-179'. */
        readonly version: string;
        /** 'positron' or 'workbench'. */
        readonly profile: string;
        /** Base URL for building a citable web link to a page in this bundle. */
        readonly docsBaseUrl: string;
        /** True when the bundle matches the running build exactly. */
        readonly isExactMatch: boolean;
    }

    export function getLocalDocs(): Thenable<LocalDocs | undefined>;
}
```

Returning manifest fields rather than a bare path matters. The assistant needs `docsBaseUrl` to cite
a real web link for a page it read locally, `schema` to refuse a format it does not understand
instead of misparsing one, and `isExactMatch` to caveat answers without string-comparing against
`positron.version`.

`undefined` means exactly one thing: no local docs, fall back to the web.

There is deliberately no `onDidChangeLocalDocs` event. Because `getLocalDocs()` joins an in-flight
fetch, the only case an event would serve is "failed, then later succeeded", and calling
`getLocalDocs()` per docs need covers that at no cost since successful results are cached in-process.

### `IPositronDocsService` does not change

It stays browser-layer and URL-only, serving Help (`helpActions.ts:448`), the welcome page
(`gettingStarted.ts`), release notes (`update.contribution.ts:85`), the notebook prompt
(`positronNotebookPrompt.ts:51`), and the help pane (`positronHelpService.ts:252`) exactly as today.
The new API is purely additive, so none of those call sites carries risk from this work.

### Merge surface

Almost everything is new files. Two upstream files change by one `registerSingleton` line each,
inside `// --- Start Positron ---` markers: `extHost.node.services.ts` and
`extHost.worker.services.ts`. The rest (`extHost.positron.api.impl.ts`, `positron.d.ts`,
`product.json`) is already Positron-owned.

Five new source files, four small edits, plus tests.

## Behaviour

### Inputs

| Input | Source |
|---|---|
| `version` | `formatPositronVersion(initData.positronVersion, initData.positronBuildNumber)`, giving `2026.05.0-179` and correctly omitting `-0` for dev builds |
| `channel` | `initData.quality`: `'releases'`, `'dailies'`, or `undefined` in dev builds |
| `profile` | `process.env.RS_SERVER_URL` present means `'workbench'`, otherwise `'positron'` |
| `baseUrl` | new `product.json` field `positronDocsBundleUrl`, default `https://cdn.posit.co/positron/releases/docs` |

The version formatter already exists at
`src/vs/platform/extensionManagement/common/positronGalleryTelemetry.ts:61`. A telemetry module is a
slightly odd home for it, but relocating it would add merge surface to two upstream-modified files
for no functional gain, so we import it as-is.

### Version resolution and convergence

`state.json` records a `resolution` field, and tracks the requested version separately from the
version the bundle actually contains.

| `resolution` | When | Per-launch network |
|---|---|---|
| `exact` | bundle version equals app version | none; terminal |
| `fallback` | release channel where exact 404'd, or the app updated past the cached bundle | `HEAD` exact plus conditional `GET` latest |
| `latest-by-policy` | dailies and dev builds, where `latest` is the intended target | conditional `GET` latest |

Dev builds landing on `latest` is deliberate: it means the feature is exercisable locally and in PRs
without waiting on a release.

While in `fallback`, each launch does two small requests:

1. `HEAD` the exact URL. On `200`, `GET` it, swap it in, and set `resolution: 'exact'`. From then on
   that install never touches the network again.
2. On `404`, conditional `GET` on `latest` with the stored ETag. `304` keeps what we have; `200`
   replaces it. Using `latest` rather than comparing versions keeps this monotonic without needing a
   version comparator.

`fallback` is therefore a transient state that re-attempts exact on every launch until it converges.
There is no path where a mismatch is noticed and then abandoned. The `HEAD` is a few hundred bytes,
so re-attempting indefinitely costs nothing even in the pathological case where a release's docs
bundle is never published.

Release builds are network-free once **exactly matched**, not merely once cached. That is the honest
cost of the fallback.

**Update side effect.** `fallback` also covers app updates. If you hold exact docs for
`2026.05.0-179` and update to `2026.06.0-42` before that release's docs publish, the exact URL 404s,
but a real bundle is already on disk, so it is served as `fallback` while convergence continues.
Meaning: after the first successful fetch ever, a user always has some local docs, and the assistant
never silently regresses to web-only because of an update. Pruning respects this - the old version
directory survives until a replacement is safely swapped in.

### Triggers: three entry points, one operation

1. **Launch.** A `RunOnceScheduler` fires 5 seconds after extension-host construction. Skips entirely
   if `ai.enabled !== true`.
2. **Config flip.** `onDidChangeConfiguration` for `AI_ENABLED_KEY`, false to true.
3. **First need.** `getLocalDocs()` starts the operation if idle, joins it if in flight, or returns
   the cached result if complete.

All three call `cache.ensure()`, which single-flights.

`ai.enabled` is `WINDOW`-scoped and toggles without a reload, so it is read live rather than captured
at construction. With `ai.enabled === false`, triggers 1 and 2 never fire and `getLocalDocs()`
returns `undefined` without touching the network. Cached files are left on disk: 655KB is cheap
enough that deleting them, only to re-download on toggle-back, is not worth it.

### Skip rule for self-hosted docs

If `POSITRON_DOCS_URL` is set, an admin has deliberately redirected docs, often precisely because
`cdn.posit.co` is unreachable. We skip the CDN fetch and return `undefined`, so the assistant uses
the configured URL through the existing browser-side path. This avoids a guaranteed-failing network
call on every launch of an air-gapped Workbench. The extension host reads this from `process.env`,
inherited from the server process.

### Cache layout

Root is `joinPath(dirname(initData.environment.globalStorageHome), 'positron-docs')`: a sibling of
`globalStorage`, so there is no risk of colliding with an extension id.

```
<userdata>/User/positron-docs/
  state.json              # schema, version, requestedVersion, resolution, profile,
                          # etag, sourceUrl, fetchedAt, lastAttemptAt, lastError?
  2026.05.0-179/          # extracted bundle, named by the bundle's own version
    bundle.json
    llms.txt
    welcome.llms.md
    release-notes/...
  .staging-<uuid>/        # transient
  .tmp-<uuid>.zip         # transient
```

Version-stamping is what makes the release-channel path network-free: the check is
`exists(<root>/<version>/bundle.json)`.

This means one 655KB copy per user profile, since `globalStorageHome` is profile-scoped. That is
cheap enough that it is not worth adding a new `IEnvironment` field to avoid.

### Safety

Following the precedents in `chat/browser/githubRepoFetcher.ts` and
`extensions/positron-data-driver-pins/src/pinsCache.ts`:

- Download to `.tmp-<uuid>.zip`, extract to `.staging-<uuid>/`, then `rename` into `<version>/`. The
  atomic swap means a killed process can never leave a half-populated version directory that later
  looks like a cache hit.
- **Validate before swapping:** `bundle.json` parses, `schema === 1`, `llms.txt` is present, and the
  extracted file count matches `fileCount`.
- **Zip-entry traversal guard:** reject entries containing `\0`, absolute paths, or anything
  resolving outside the target (`isEqualOrParent`). `base/node/zip.ts` does some of this, but the
  archive arrives over the network, so we assert it ourselves rather than trusting it.
- **Cap the download** at 5MB, so a wrong or hostile object cannot fill the disk. The real bundle is
  about 150KB.
- **Prune on success:** keep the current version directory, delete other version directories and
  stale `.staging-*` and `.tmp-*` entries.

### Failure modes

| Failure | Behaviour |
|---|---|
| No network or DNS failure | info log, `undefined`, retry next launch |
| 404 on exact | fall back to `latest`, set `resolution: 'fallback'`, re-attempt exact every launch |
| 404 on latest as well | info log, `undefined`, retry next launch |
| 304 on latest | keep cache, no extract, refresh `fetchedAt` |
| Corrupt zip or extract error | discard temp and staging, `undefined`, retry next launch |
| `schema !== 1` | warn log, `undefined`; never guess at an unknown format |
| Validation mismatch | discard staging, `undefined` |
| Disk full or write error | warn log, `undefined`, existing cache untouched |

Every failure produces the same user-visible outcome: the assistant falls back to the web, exactly as
it behaves today. **No notifications or error toasts.** This is invisible infrastructure, and a docs
download failing is not worth interrupting anyone over.

One attempt per trigger, with no in-session backoff loop. A failure sets `lastAttemptAt`, and we do
not re-attempt in the same session except on an `ai.enabled` flip.

### Observability

Logging goes through the extension-host `ILogService`, prefixed `[positron-docs]`: info for the
resolved URL, version, decision (cache hit, 304, downloaded) and timing; warn for validation and
schema problems; no error level, since nothing here is user-actionable.

**No telemetry event in v1.** This is the deferral we are least sure about: a single event recording
cache-hit versus web-fallback rate is what would tell us whether the exact-on-releases policy leaves
release users on web docs more often than expected. Worth revisiting once it ships rather than
guessing now.

## Testing

### Vitest carries almost all of it

The seam is what makes this possible: `PositronDocsCache` has three injected ports and no host
dependency, so the entire state machine is unit-testable.

**`src/vs/platform/positronDocs/test/common/positronDocsBundle.vitest.ts`** - plain, no fakes.
Table-driven cases for `resolveBundleRequest` (releases to exact, dailies to latest, dev build to
latest, workbench profile to `positron-workbench-llms-...`) and `parseManifest` (valid schema 1,
rejects schema 2, rejects malformed JSON). These are simple mappings, so a handful of cases rather
than exhaustive coverage.

**`src/vs/platform/positronDocs/test/common/positronDocsCache.vitest.ts`** - the state machine, where
the real branching lives:

- cold cache: downloads, validates, swaps, writes state, `resolution: 'exact'`
- warm exact cache: asserts the fake HTTP client was never called
- fallback, `HEAD` exact `200`: converges to exact, old version directory pruned
- fallback, `HEAD` exact `404`, conditional `GET` latest `304`: keeps cache
- fallback, same but `200`: replaces cache
- app version moved past cached bundle: enters fallback and still serves the old docs
- dailies: never `HEAD`s exact
- corrupt zip: staging discarded, no version directory created, previous cache intact
- `schema !== 1`: rejected
- `fileCount` mismatch: rejected
- zip entry escaping the target: rejected
- oversize download: aborted
- two concurrent `ensure()` calls: one download

The convergence tests assert **intermediate** state, that the fallback bundle was actually served
before convergence, not only the final exact result. A test that checked only the end state would
pass even if the fallback never worked.

**`src/vs/workbench/api/test/node/positron/extHostDocsNode.vitest.ts`** (matching the existing
`api/test/browser/positron` and `api/test/common/positron` convention) - the trigger logic, with
`stubInterface` for init data and configuration:

- `ai.enabled === false` at launch: scheduler fires, `ensure()` never called
- `ai.enabled` false to true: `ensure()` called once
- `POSITRON_DOCS_URL` set: `getLocalDocs()` returns `undefined`, no `ensure()`
- `getLocalDocs()` during an in-flight fetch: joins, does not start a second
- constructing the service performs zero port calls, asserting the failure-isolation discipline that
  is the one risk specific to this placement

### What we deliberately do not test

**No extension-host Mocha test.** The API surface is a one-line delegation; an activated extension
host would reveal nothing the unit tests do not.

**No E2E.** This is invisible infrastructure with no user-visible workflow. An E2E would need either
a real CDN round-trip or a fixture server, and would test the network rather than the product.
Explicit non-goal.

### Manual validation

Automated tests cannot prove the CDN integration works, so that part is manual:

1. Dev build: confirm `latest-by-policy`, cache at `<userdata>/User/positron-docs/<version>/`, and a
   log line showing the resolved URL and decision.
2. `ai.enabled: false`: confirm no network egress and `getLocalDocs()` returning `undefined`.
3. Flip `ai.enabled` on mid-session: fetch fires without a reload.
4. Delete the cache mid-session, call `getLocalDocs()`: lazy re-fetch, and a second concurrent call
   joins it.
5. Point `positronDocsBundleUrl` at a local static server serving hand-made bundles: drive the 404,
   exact, fallback, and 304 transitions without waiting on a release cycle. This is what makes the
   feature verifiable on demand.
6. Workbench: profile resolves to `workbench`, and the cache lands on the server's filesystem where
   the remote extension host can read it.
7. `POSITRON_DOCS_URL` set: confirm the skip.

## Rollout

1. **Website PR (Step 1).** Slim bundles, `latest` aliases, and the guard. Independently shippable,
   adds two CDN objects per profile, changes nothing existing. Must land and run once before the
   Positron side is verifiable against the real CDN; manual validation step 5 unblocks local work in
   the meantime.
2. **Positron PR (Step 2).** The seam, the extension-host API, and the `product.json` field. Ships
   safely with no consumer: the only observable effect is a background fetch on launch when
   `ai.enabled` is true.
3. **Assistant PR (Step 3).** Out of scope here, unblocked by the handover contract below.

**No new user-facing setting in v1.** `ai.enabled` is the documented single main switch for AI
features and adding a second dilutes it, and `POSITRON_DOCS_URL` already covers the managed and
air-gapped Workbench cases. Revisit only if a customer asks for a desktop-side opt-out.

## Handover contract for the assistant (posit-dev/assistant)

Written down so the assistant repo can proceed independently:

- **Feature-detect:** `typeof positron.docs?.getLocalDocs === 'function'`. The assistant ships on its
  own cadence and will run on Positron builds that predate this API.
- **Call `positron.docs.getLocalDocs()` per docs need.** Results are cached in-process, so repeat
  calls are free. `undefined` means today's web behaviour, unchanged.
- **On a result,** read `<path>/llms.txt` for the index. Its links are bundle-relative paths; read
  the named `.llms.md` files with ordinary filesystem APIs.
- **To cite a web link,** join `docsBaseUrl` with the relative path and swap `.llms.md` for `.html`.
- **Refuse the bundle** if `schema` is not a version it understands.
- **Caveat answers** when `isExactMatch === false`.

## Non-goals

- No change to `IPositronDocsService` or its five existing URL consumers.
- No baked installer snapshot (spike option B) and no hybrid (option C).
- No local docs for Help, the welcome page, or release notes. Those stay on the web, and would need
  the full bundle or a Markdown renderer anyway.
- No handling of the existing 67MB full bundles.
- No telemetry in v1.
- No new user-facing setting.
