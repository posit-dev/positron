# Bundling Positron docs on disk: design spec

Date: 2026-07-27

Status: Approved for implementation

Author: Marie Idleman (with Claude)

Supersedes: [2026-07-24 spike](./2026-07-24-positron-bundle-docs-spike.md) (analysis of options A/B/C)

Revision 2 (2026-07-27), after a design review of revision 1. Changes: added the cache-present rule
(revision 1's failure table contradicted its own always-have-local-docs guarantee), specified what
`getLocalDocs()` returns in `fallback`, addressed concurrency across windows, added digest
verification, bounded the `getLocalDocs()` wait, scoped retry throttling to hard failures only, split
Step 2 into two PRs, and added the `POSITRON_LLMS_DOCS_URL` override that manual validation depends
on.

Revision 3 (2026-07-27), closing the gaps revision 2's digest sidecars introduced. Changes: specified
sidecar-404 handling (strict, with a publish-order rule and a CI guard to shrink the race window),
clarified that `state.json`'s `sha256` is recorded once and never recomputed, noted that manual
validation's local server must host sidecars, and corrected two code references (the server build
gulpfiles and the extension-host entry point).

Revision 4 (2026-07-28), dropping the `POSITRON_DOCS_URL` skip rule. It rested on an unsound
inference (a mirrored docs site does not imply an unreachable CDN), saved only one failed lookup per
throttle window, could not deliver the mirror to the assistant anyway, and contradicted the same
section's air-gap guidance to override the bundle URL. An unreachable CDN is now handled solely by the
ordinary failure path.

Revision 5 (2026-07-28), adding the schema versioning policy. Revision 1 defined what schema 1 means
but never said when the number moves, leaving the next editor of the website pipeline without a rule.
Adds the bump-versus-additive criteria, the dual-publish transition that keeps a bump from becoming a
flag day for every deployed install, and a note that the assistant-side `schema` check is currently
unreachable by design.

Revision 6 (2026-07-28), dropping the "no E2E" non-goal, which ruled out integration coverage on the
grounds that there is no user-visible workflow. Adds one gating `e2e-electron` test against a local
fixture server, a scheduled non-gating contract check, and PRs 2c and 5 to carry them. The non-goal is
deleted rather than narrowed, since Step 3 will make it false: once the assistant reads the bundle, the
same test extends to a real user-visible assertion.

Revision 7 (2026-07-28), renaming the bundle-URL override from `POSITRON_DOCS_BUNDLE_URL` to
`POSITRON_LLMS_DOCS_URL`, and the `product.json` field from `positronDocsBundleUrl` to
`positronLlmsDocsUrl`. The old name shared the `POSITRON_DOCS_` prefix with the pre-existing
docs-website variable `POSITRON_DOCS_URL`, which caused a real misreading during review. `llms` is
already the vocabulary of every artifact (`llms.txt`, `*.llms.md`, `positron-llms-<version>.zip`), so
the new name diverges at the second word while staying greppable alongside other docs config. Nothing
is shipped yet, so the rename is free.

Revision 8 (2026-07-28), from the Part A implementation review. Adds two failure-mode rules the earlier
revisions left implicit. First, a digest mismatch on a `latest` alias is retryable: both alias objects
are mutable and uploaded separately, so every release has a window where the sidecar is new and the zip
is not, and a client treating that as corruption would poison its cache over a condition that clears in
seconds. Second, records that a bad *versioned* bundle cannot be recalled, because immutable publishing
plus terminal `exact` resolution leaves no lever that reaches an install which already cached it -- noted
with candidate levers rather than solved, since docs are read-only assistant context.

Revision 9 (2026-07-28), from executing the Part A workflow end to end against a local S3 (moto) with
bundles built by the real script from a real Quarto render. The publish path behaved as specified -- 8
objects on `releases`, 4 on `staging` with the alias step correctly skipped, cache-control right per
object kind, alias bytes identical to the versioned zip, and the assertion step genuinely failing on a
missing object and on a wrong cache-control value. One new fact came out of it: a bundle version does
not imply a unique digest, because `generated` is wall-clock and the stage is rebuilt each run. Harmless
to a client, which verifies a zip against the sidecar it fetched alongside, but recorded so nothing
downstream treats `version` as a content identity.

Revision 10 (2026-07-29), correcting the launch trigger's anchor. Revisions 1 through 9 fired the
launch fetch 5 seconds after extension-host *construction*, which is the wrong reference point. The
delay exists to keep a download from competing with startup, and construction happens before eager
extensions activate -- so on a cold start with slow interpreter discovery, a construction-anchored 5
seconds lands in the middle of the burst it was meant to avoid. The trigger now waits for the
startup-finished moment and then adds 5 seconds, which self-adjusts to the machine instead of guessing
how long activation takes. That moment is not publicly exposed today, so this adds a third Positron
block to `extHostExtensionService.ts`, and anchors on upstream's own 10-second-capped race rather than
the uncapped `_eagerExtensionsActivated` barrier, so a hung eager extension delays the download by a
bounded amount instead of suppressing it entirely.

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
| Trigger | On launch, 5 seconds after eager extension activation settles (gated on `ai.enabled`); on `ai.enabled` flipping true; and joined by a first-need call. |
| Placement | Extension-host-resident `positron.docs` API, with all logic in a host-agnostic module behind injected ports. |
| URL rewriting | Done in the website pipeline, enforced by a CI guard. |

## Why the extension host

The download has to run where the extension host runs, because the extension host is the only
consumer.

A browser/renderer-layer service cannot work. In Workbench the extension host is a Node process on
the server: its entry point is `src/vs/workbench/api/node/extensionHostProcess.ts`, which
`src/vs/server/node/extensionHostConnection.ts` spawns as a child process. Browser-layer
`IFileService`, by contrast, writes to IndexedDB in the user's browser. The assistant could never read that. `base/node/zip.ts`
is node-layer only, so unzipping in the renderer is not possible either.

Two placements remained: an extension-host-resident API, or a `platform/` node service registered in
both `sharedProcessMain.ts` and `serverServices.ts` with an IPC channel and a main-thread bridge.

The extension host wins on three counts:

- **Correctness in remote windows.** With SSH or dev containers the extension host runs on the remote
  host. An extHost-resident download lands there, co-located with its consumer. A platform service
  would have two instances (local shared process plus remote server) and would need a rule for which
  one serves the extension host versus core UI.
- **Merge surface.** Three upstream files change -- two by a single `registerSingleton` line, one by a
  small wrapped block -- versus the platform route's registrations in `sharedProcessMain.ts` and
  `serverServices.ts` plus an IPC channel and a main-thread bridge. Positron's upstream-compatibility
  guidance favours the smaller surface.
- **The "core might want this later" argument is weaker than it looks.** Help, the welcome page, and
  release notes render HTML. The slim bundle is Markdown with no chrome, so core UI would need the
  full 67MB bundle or a Markdown renderer regardless of where the download lives.

The mitigation for the one real cost (core cannot consume this without an inverted dependency on the
extension host) is the seam: all logic lives in a host-agnostic `platform/` module behind injected
ports, so re-hosting it in a node service later is a second thin wiring rather than a rewrite. That
is also what makes it unit-testable.

The genuine risk of this placement is that a slow or hung download must never be awaited on an
extension-activation path. That is a discipline requirement with a test asserting it.

### The spike's Workbench packaging prerequisite does not apply

The spike's "Workbench carryover" section flags that confirming the docs folder is included in the
server build is a prerequisite, since the desktop `vscodeResources` glob
(`build/gulpfile.vscode.ts`), the REH `serverResources` glob (`build/gulpfile.reh.ts`), and the web
client's resource globs (`build/gulpfile.vscode.web.ts`) are all defined independently. **That
prerequisite belonged to option B and is moot here.** Option A bakes nothing into any build; the
bundle arrives at runtime on the extension host's own filesystem, which in Workbench is the server.
None of those three glob sets changes, and none of the `'!**/test/**'` or `node/` exclusion traps
that would have applied to a baked folder are in play.

Stated explicitly because a reader of the spike would otherwise carry an outstanding Workbench
packaging task into implementation that does not exist.

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

### Schema versioning policy

`schema` versions the bundle *layout*. It is the contract between one producer (this pipeline) and two
consumers that ship on their own release trains (Positron core's `parseManifest`, and the assistant in
`posit-dev/assistant`). Docs text changes on every publish and moves `version`; `schema` moves only
when a reader written against the old layout would get a wrong answer from a new bundle.

The check is not defensive boilerplate. Dev and daily builds fetch the **mutable** `latest` alias, so
"an app from three months ago is handed a bundle from today's pipeline" is a normal runtime state, not
a hypothetical. Without the stamp, a consumer would have to sniff the layout -- inspecting `llms.txt`
to guess whether its paths are absolute or relative -- and guess wrong silently.

**Bump when a schema-1 reader would misread the bundle:**

- the `llms.txt` path convention changes (back to absolute URLs, or to a different root)
- docs files are renamed away from `**/*.llms.md`
- the directory layout changes in a way a consumer walks
- a required `bundle.json` field changes type or meaning, or is removed

**Do not bump for additive changes:** a new optional `bundle.json` field, additional files, a new
profile, a different `fileCount`, or any change to the docs text itself.

Getting this wrong is asymmetric. A layout change shipped *without* a bump leaves old installs parsing
a bundle labelled `1` that is not one, and the symptom surfaces later as missing or wrong docs content
rather than as a clean rejection. When in doubt, bump: a bump is visible and recoverable, a silent
misparse is neither.

#### A bump breaks every deployed client at once

`parseManifest()` rejects any `schema !== 1` and a cold cache then yields `undefined` (see "Failure
modes"). Because the `latest` alias is a single mutable path shared by every install, publishing
schema 2 over it would stop local docs for **every Positron build that predates schema 2,
simultaneously**. Warm caches keep serving their existing schema-1 bundle, but cold-cache installs get
nothing until the user updates the app.

Rejecting is still correct -- misparsing is worse -- so the mitigation is in the publish step, not the
client: **publish the new schema at new keys and keep publishing the old one for a transition window.**

```
positron-llms-latest.zip          # schema 1, keep publishing
positron-llms-v2-latest.zip       # schema 2, new clients request this by name
```

`resolveBundleRequest` already builds the requested URL, so a client asks for the highest schema it
understands and older clients keep hitting the keys they already know. At 150KB per artifact the
duplicate publish is negligible against the four objects per profile already being uploaded.

**Retirement signal for the old keys:** stop publishing schema-1 once the oldest build still in support
requests `v2-latest` -- that is, once no shipped `resolveBundleRequest` asks for the schema-1 keys.
Naming the signal matters because "retire when the floor moves" has no test attached to it, and
duplicate publishing is cheap enough that it will otherwise continue forever by default. Who owns the
retirement is a question for the schema-2 rollout, not this spec, and belongs in the backlog item that
introduces it.

Stated here rather than deferred to the day it happens, because by then the flag-day cost is already
priced in and the cheap fix is no longer available.

### Digest sidecar

Each zip is published alongside a `<zipname>.sha256sum` sidecar containing the hex digest of the zip.
Positron fetches the sidecar with the zip and verifies the digest before extracting.

The digest cannot live inside `bundle.json`, since that file is inside the archive being hashed. A
sidecar is one extra tiny object per artifact and lets corruption be caught before anything is
extracted. HTTPS already protects the transport; this covers CDN and disk storage corruption, which is
the failure that would otherwise surface as a confusing parse error much later.

**Publish order: sidecar first, then the zip, then the `latest` aliases.** Positron treats a missing
sidecar as a verification failure and refuses to extract (see "Failure modes"), so a zip that is
reachable before its digest is a window in which a cold-cache install gets no local docs. Uploading
the sidecar first makes that window near zero, and moving the aliases last means the mutable path
never points at a versioned object whose digest has not landed. Per profile the order is:
`<version>.zip.sha256sum`, `<version>.zip`, then `latest.zip.sha256sum` and `latest.zip`.

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
| `positron-llms-<version>.zip.sha256sum` | immutable | long `max-age` |
| `positron-workbench-llms-<version>.zip` | immutable | long `max-age` |
| `positron-workbench-llms-<version>.zip.sha256sum` | immutable | long `max-age` |
| `positron-llms-latest.zip` | moves each release | `no-cache` |
| `positron-llms-latest.zip.sha256sum` | moves each release | `no-cache` |
| `positron-workbench-llms-latest.zip` | moves each release | `no-cache` |
| `positron-workbench-llms-latest.zip.sha256sum` | moves each release | `no-cache` |

`no-cache` on the aliases is what makes the ETag check meaningful: CloudFront revalidates with the
origin instead of serving a stale edge copy, so a `304` genuinely means unchanged.

CloudFront invalidation covers only the two `latest` keys. The versioned objects are new keys and
need none.

**Channel note.** Docs bundles are published only under `releases/docs/`, since the website publishes
at release time. Dailies read from that same prefix via the `latest` alias; they do not look under
`dailies/docs/`.

This reuses the existing render, S3 upload, and invalidation, with four new CDN objects per profile
per release (a versioned zip and alias zip, each with a digest sidecar). The spike's 5-10 line
estimate covered the zip step alone; the digest sidecars, the guards, and the `Cache-Control`
assertion make it closer to 30 lines.

### Website-side validation

The CI guard is the test:

- no bundled file matches `positron.posit.co`
- the zip contains `llms.txt` and `bundle.json`
- `bundle.json`'s `schema` equals a constant declared in the workflow, so changing the emitted schema
  requires editing that constant deliberately and cannot happen as a side effect of a layout change
  (see "Schema versioning policy")
- every path in `llms.txt` is bundle-relative, which is the specific invariant schema 1 promises
- the extracted file count matches `bundle.json`'s `fileCount`
- the `.sha256sum` sidecar matches the zip it accompanies
- every uploaded zip has a reachable sidecar once the upload step completes, asserted after the
  aliases move, so a publish that drops a sidecar fails the workflow rather than shipping a zip
  Positron will refuse
- both `latest` aliases carry `Cache-Control: no-cache` after upload

Any failure fails the workflow.

That last check matters more than it looks. If a `latest` alias is ever published with a long
`max-age`, CloudFront serves a stale edge copy and answers the conditional `GET` with `304` even
though the content moved. Every dailies install would then pin itself to whatever docs happened to be
cached at the edge, and nothing in Positron could detect it. Asserting the header at publish time is
the only place this is cheap to catch.

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
   - `IDocsFileStore` - exists, read, write, mkdir, rename, delete, readdir, `mtime`, and
     `sha256(uri)`. The digest sits here rather than in its own port because hashing needs node
     `crypto`, which `common` cannot import; treating it as a file operation keeps the port count down
     without leaking a node dependency into the seam. `mtime` exists for the prune guard below.
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
but the constructor only awaits the startup-finished signal, arms a `RunOnceScheduler` off it, and
installs the `ai.enabled` listener. It never touches the network inline, and it does not block on the
signal -- the await is a floating continuation, so construction returns immediately. That is the
discipline that keeps a slow download off the activation path.

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

Almost everything is new files. Three upstream files change, all inside `// --- Start Positron ---`
markers:

- `extHost.node.services.ts` -- one `registerSingleton` line.
- `extHost.worker.services.ts` -- one `registerSingleton` line.
- `api/common/extHostExtensionService.ts` -- a `Barrier` field, one `.open()` call inside the existing
  `Promise.race([eagerExtensionsActivation, timeout(10000)])` continuation in
  `_handleEagerExtensions()`, and a public `whenStartupFinished()` accessor on
  `IExtHostExtensionService`. Positron already carries two wrapped blocks in this file (`:518`,
  `:532`), so it is not a new merge surface, just a slightly wider one.

The rest (`extHost.positron.api.impl.ts`, `positron.d.ts`, `product.json`) is already Positron-owned.

Five new source files, five small edits, plus tests.

The `extHostExtensionService.ts` block is the one piece of this design that could not be done without
touching upstream. The alternative -- a fixed delay from construction -- needs no upstream change, and
was rejected for the reasons in "The launch anchor".

## Behaviour

### Inputs

| Input | Source |
|---|---|
| `version` | `formatPositronVersion(initData.positronVersion, initData.positronBuildNumber)`, giving `2026.05.0-179` and correctly omitting `-0` for dev builds |
| `channel` | `initData.quality`: exactly `'releases'`, `'dailies'`, or `undefined` in dev builds |
| `profile` | `process.env.RS_SERVER_URL` present means `'workbench'`, otherwise `'positron'` |
| `baseUrl` | new `product.json` field `positronLlmsDocsUrl`, default `https://cdn.posit.co/positron/releases/docs` |

The version formatter already exists at
`src/vs/platform/extensionManagement/common/positronGalleryTelemetry.ts:61`. A telemetry module is a
slightly odd home for it, but relocating it would add merge surface to two upstream-modified files
for no functional gain, so we import it as-is.

**The `quality` strings are verified, not assumed.** `build/utils.ts:31` defines
`releaseChannel = process.env.POSITRON_RELEASE_CHANNEL ?? 'dailies'` with `'dailies'` and `'releases'`
as its only values, and stamps it into `product.json` as `quality` (`build/gulpfile.vscode.ts:341`,
`build/gulpfile.reh.ts:515`). `src/vs/server/node/positronStaticRoute.ts:8` already branches on
`quality !== 'dailies'`. Positron does **not** use VS Code's `stable`/`insiders` values here, so
there is no risk of a release build being misclassified as a daily. The Vitest table asserts each of
the three inputs (`'releases'`, `'dailies'`, `undefined`) maps to its expected resolution, so a future
channel rename fails a test rather than silently changing behaviour.

### The cache-present rule

**A valid cached bundle is always served, whatever the current fetch attempt does.**
`getLocalDocs()` returns `undefined` only when no valid cache exists. A fetch attempt can *replace*
the served bundle (on success) but never *withdraws* one (on failure).

This single rule governs every row of the failure table below, and it is what makes the guarantee in
"Update side effect" hold for all three resolutions rather than just `fallback`. Without it stated
once, up front, the natural reading of "network failure -> `undefined`" would have a cached dailies
user drop to web docs during an outage.

"Valid" for an *already-cached* bundle means: `state.json` parses, its `version` directory exists,
that directory's `bundle.json` parses with `schema === 1`, and `llms.txt` is present. `getLocalDocs()`
returns the version directory named in `state.json`, and convergence replaces that directory
atomically, so there is never a moment where the recorded path does not exist.

**`state.json`'s `sha256` is recorded at download time and never recomputed.** It is a diagnostic
record of what was verified before extraction, not a live checksum. Re-hashing on access would mean
keeping the zip on disk after extracting it (we delete it) and would hash 150KB on a path that runs
per docs need. Post-download disk corruption is caught by the cheap structural checks above --
`bundle.json` parsing and `llms.txt` presence -- which is proportionate: the bundle is Markdown the
assistant reads as text, so a corrupted byte inside a page degrades one answer rather than
compromising anything. Digest verification exists to gate *extraction* of a freshly downloaded
archive, which is the step where a bad payload could write outside the target.

### Version resolution and convergence

`state.json` records a `resolution` field, and tracks the requested version separately from the
version the bundle actually contains.

| `resolution` | When | Per-launch network | `getLocalDocs()` returns |
|---|---|---|---|
| `exact` | bundle version equals app version | none; terminal | the cached version directory |
| `fallback` | release channel where exact 404'd, or the app updated past the cached bundle | `HEAD` exact plus conditional `GET` latest | the cached version directory named in `state.json`, with `isExactMatch: false` |
| `latest-by-policy` | dailies and dev builds, where `latest` is the intended target | conditional `GET` latest | the cached version directory |

Dev builds landing on `latest` is deliberate: it means the feature is exercisable locally and in PRs
without waiting on a release.

While in `fallback`, a launch that downloads nothing costs two small requests:

1. `HEAD` the exact URL. On `200`, `GET` it plus its digest sidecar, verify, swap it in, and set
   `resolution: 'exact'`. From then on that install never touches the network again.
2. On `404`, conditional `GET` on `latest` with the stored ETag. `304` keeps what we have; `200`
   fetches the sidecar, verifies, and replaces. Using `latest` rather than comparing versions keeps
   this monotonic without needing a version comparator.

A launch that actually downloads adds the one sidecar request. Any download therefore always pairs a
zip with its digest, so a bundle is never extracted unverified.

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

1. **Launch.** A `RunOnceScheduler` fires 5 seconds after eager extension activation settles (see
   "The launch anchor" below). Skips entirely if `ai.enabled !== true`.
2. **Config flip.** `onDidChangeConfiguration` for `AI_ENABLED_KEY`, false to true.
3. **First need.** `getLocalDocs()` starts the operation if idle, joins it if in flight, or returns
   the cached result if complete.

All three call `cache.ensure()`, which single-flights.

**`getLocalDocs()` waits at most 10 seconds.** Joining an in-flight fetch is the right default (a
150KB download usually beats the first question), but an unbounded wait would let a slow link stall an
assistant response indefinitely. On timeout it returns whatever the cache-present rule allows -- the
existing cached bundle, or `undefined` on a cold cache -- while the fetch **continues in the
background** and is available to the next call. The download is never cancelled by the timeout; only
the caller stops waiting.

Triggers 1 and 2 have no timeout, since nothing is waiting on them.

`ai.enabled` is `WINDOW`-scoped and toggles without a reload, so it is read live rather than captured
at construction. With `ai.enabled === false`, triggers 1 and 2 never fire and `getLocalDocs()`
returns `undefined` without touching the network. Cached files are left on disk: 655KB is cheap
enough that deleting them, only to re-download on toggle-back, is not worth it.

### The launch anchor

The launch delay exists to keep the download from **competing** with startup for disk, CPU, and
network. It is not there to avoid blocking a constructor -- that is handled by doing no work in the
constructor at all. Getting the anchor right therefore means anchoring on when the contention ends,
not on a fixed early point.

Two candidate reference points, several seconds apart on a cold start:

- **Extension-host construction** -- the moment our service object is created. Nothing has been
  discovered yet: no extension has run a line of its own code, the workspace is unscanned, interpreter
  discovery has not started. A fixed 5 seconds from here is a *guess* about how long the activation
  burst takes. On a fast machine with a small workspace it clears the burst; on a cold start with a
  large repo and slow Python or R discovery it lands squarely inside it, and the delay has bought
  nothing.
- **Startup finished** -- after eager extensions (`*`, `workspaceContains:`, remote resolver) have had
  their `activate()` calls settle. This is a *semantic* point rather than a guess, so 5 seconds past it
  self-adjusts: slower machines fire later, faster ones earlier, but neither fires during the burst.

**We anchor on startup finished, plus 5 seconds.**

Upstream already computes this moment in `_handleEagerExtensions()`
(`api/common/extHostExtensionService.ts:688`), where it races eager activation against a 10-second
timeout and then fires `onStartupFinished`. It is not exposed to other extension-host services, so
Positron adds a barrier opened at that same point and a public accessor to await it. See "Merge
surface".

**Anchor on the capped race, not the `_eagerExtensionsActivated` barrier.** The existing barrier
(`:834`) opens off the *un-raced* activation promise, so awaiting it is unbounded -- a single eager
extension that never finishes activating would suppress the docs download entirely, for the whole
session. Upstream's 10-second race is the bounded form of the same moment, so worst case the fetch is
delayed by roughly 15 seconds rather than lost. The two differ only when something is already wrong,
which is exactly when the download should still happen.

**The delay costs almost nothing on the read side**, because trigger 3 covers the window: a user who
asks a docs question before the scheduler fires does not wait for it, and single-flighting means the
scheduler later joins rather than duplicates. The only case that fetches nothing is a session shorter
than the anchor plus 5 seconds, which had no docs need anyway.

Reading `onStartupFinished` by calling `activateByEvent('onStartupFinished')` would be wrong: that
*fires* the event and forces those extensions to activate early, rather than observing when startup
settled.

### Self-hosted docs: `POSITRON_DOCS_URL` is a separate knob

`POSITRON_DOCS_URL` points `IPositronDocsService` at a mirror of the docs *website* for core UI links
(named in `positronDocsService.ts:24-32`; line 55 reads its resolved form,
`environmentService.positronDocsUrl`). It is unrelated to this feature, and the download path does not
read it anywhere.

Revision 2 skipped the CDN fetch whenever it was set, on the theory that an admin only redirects docs
because `cdn.posit.co` is unreachable. **That skip rule is dropped.** Three reasons:

- **The inference does not hold.** An admin may mirror the docs site for latency, version pinning, or
  branding with full internet access. The skip would then disable local docs for exactly the
  population that benefits most from them, since Workbench is where per-call WebFetch approvals and
  token cost bite hardest.
- **It saved almost nothing.** A hard failure sets `lastFailureAt` and is not retried for an hour (see
  "Retry throttling"), so a genuinely air-gapped Workbench spends one failed DNS lookup per hour, not
  one per launch.
- **It bought the user nothing.** `IPositronDocsService` is browser-layer with no extension-facing
  surface, so on skip the assistant would not have received the admin's mirror either -- it would fall
  back to the same URL it uses today.

An unreachable CDN is already covered by the ordinary failure path: one attempt, hard-failure
throttling, and the cache-present rule. No special case needed.

An air-gapped install that wants local docs sets `POSITRON_LLMS_DOCS_URL` (or overrides
`positronLlmsDocsUrl`) to an internal S3-compatible endpoint hosting the slim bundles. The two
variables stay distinct because one names a site to browse and the other a bundle to read; conflating
them would mean guessing whether a given URL serves rendered HTML or zipped Markdown.

Making the assistant honour an admin's docs mirror for the web links it cites is a real gap, but it
needs its own work to expose `baseUrl` to extensions. It is not free today and is not claimed here.

### Cache layout

Root is `joinPath(dirname(initData.environment.globalStorageHome), 'positron-docs')`: a sibling of
`globalStorage`, so there is no risk of colliding with an extension id.

```
<userdata>/User/positron-docs/
  state.json              # schema, version, requestedVersion, resolution, profile,
                          # sha256 (diagnostic; verified at download, never recomputed),
                          # etag, sourceUrl, fetchedAt, lastAttemptAt, lastFailureAt?, lastError?
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
- **Verify the digest:** hash the downloaded zip and compare it against the `<zipname>.sha256sum`
  sidecar (see Step 1). HTTPS protects the transport, but a digest catches CDN or disk storage
  corruption for the cost of one hash over 150KB.
- **Validate before swapping:** `bundle.json` parses, `schema === 1`, `llms.txt` is present, and the
  extracted file count matches `fileCount`.
- **Zip-entry traversal guard:** reject entries containing `\0`, absolute paths, or anything
  resolving outside the target (`isEqualOrParent`). `base/node/zip.ts` does some of this, but the
  archive arrives over the network, so we assert it ourselves rather than trusting it.
- **Cap the download** at 5MB, so a wrong or hostile object cannot fill the disk. The real bundle is
  about 150KB.
- **Prune on success:** keep the current version directory, delete other version directories, and
  delete `.staging-*` and `.tmp-*` entries **whose mtime is older than 10 minutes** (see below).

### Concurrency across windows

`cache.ensure()` single-flights within one process, but **each window has its own extension host**, so
two windows opening together will both reach the download branch against the same cache directory.

Data integrity is already safe: both validate before swapping, and the atomic `rename` into
`<version>/` means last-writer-wins on identical content. `state.json` is likewise written with a
temp-file-plus-rename, and since both processes are the same app version they compute the same
`resolution`, so a lost update is benign.

The one real hazard is pruning: window A's prune would otherwise delete window B's in-flight
`.tmp-<uuid>.zip` or `.staging-<uuid>/`, producing a spurious failure and retry. Hence the mtime
guard above -- prune only touches transient entries that have been idle for 10 minutes, which are by
definition abandoned leftovers rather than active work. No lock file needed.

This is worth stating explicitly because the failure it prevents is intermittent, multi-window-only,
and would be extremely annoying to diagnose from a bug report.

### Failure modes

Read every row through the cache-present rule: the "no cache" column is what happens on a cold cache,
and the "cache present" column is what happens otherwise.

| Failure | No cache | Cache present |
|---|---|---|
| No network, DNS, or connection failure | info log, `undefined` | info log, serve cache, set `lastFailureAt` |
| 5xx from the CDN | info log, `undefined` | info log, serve cache, set `lastFailureAt` |
| 404 on exact | fall back to `latest` | fall back to `latest`; set `resolution: 'fallback'` and keep re-attempting exact each launch |
| 404 on latest as well | info log, `undefined` | info log, serve cache |
| 304 on latest | n/a | serve cache, no extract, refresh `fetchedAt` |
| Corrupt zip or extract error | discard temp and staging, `undefined` | discard temp and staging, serve cache unchanged |
| `schema !== 1` | warn log, `undefined`; never guess at an unknown format | warn log, serve cache unchanged |
| Validation or `sha256` mismatch | discard staging, `undefined` | discard staging, serve cache unchanged |
| `sha256sum` sidecar 404 or unparseable | treat as a validation failure: discard temp, `undefined`, never extract unverified | same; serve cache unchanged |
| Disk full or write error | warn log, `undefined` | warn log, serve cache unchanged |
| Download exceeds the 5MB cap | abort, discard temp, `undefined` | abort, discard temp, serve cache unchanged |

The cold-cache column produces one user-visible outcome: the assistant falls back to the web, exactly
as it behaves today. **No notifications or error toasts** in either column. This is invisible
infrastructure, and a docs download failing is not worth interrupting anyone over.

**A missing sidecar is a hard no, never a soft pass.** A zip that cannot be verified is not extracted,
even though that means a cold-cache install gets no local docs until the sidecar appears. Proceeding
unverified would make the digest decorative: an attacker or a corrupted CDN object only has to also
remove the sidecar to bypass it. The cost of strictness is bounded -- a transient publish-window race
delays local docs by one launch and the next launch converges, which is the same behaviour as a 404 on
the zip itself. Step 1's publish order below keeps that window near zero.

**A digest mismatch on a `latest` alias is retryable, not terminal.** The two alias objects,
`<basename>-latest.zip` and its `.sha256sum`, are both mutable and are uploaded by two separate
`aws s3 cp` calls, so every release has a brief window in which the sidecar already carries the new
digest while the zip is still the previous release's bytes. No publish order removes this -- zip-first
merely inverts which side is stale -- and `no-cache` on both means a client can genuinely observe the
mismatched pair rather than a pinned stale copy. A client that treats this as corruption and records a
permanent failure would poison its own cache state over a condition that resolves in seconds.
Treat a mismatch on an alias as a transient publish-window race: discard the download, do not mark the
cache bad, and let the next trigger converge. A mismatch on a *versioned* object is different -- those
are immutable and written once, so there the mismatch is real.

**A version does not imply a unique digest.** Bundles are not byte-reproducible across runs:
`bundle.json` carries a wall-clock `generated` field, and the staged files are written fresh each run,
so re-running the release workflow for the same version produces a different zip and a different
`sha256`. Observed directly - two runs for `2026.05.0-179` seventy-six seconds apart produced digests
`3f8e5106...` and `49d06070...`. This does not break a client, because a client fetches the zip and its
sidecar together and verifies them against each other, never against a remembered digest. But two
installs nominally on the same version can legitimately hold bundles with different digests, so nothing
downstream should treat `version` as a content identity or compare digests across installs to detect
corruption. `immutable` in the cache-control header is a statement about caching policy, not a promise
of byte-stability.

**A bad versioned bundle cannot be recalled, and that is a gap this design does not close.** Versioned
objects are published `immutable` with a one-year max-age, and a release build resolving `exact` is
terminal: it reads `<basename>-<version>.zip` and never consults the alias again. So if a bad bundle
ships for release version X, no lever reaches an install that already cached it -- re-uploading the key
does nothing for existing clients, CloudFront invalidation only helps cold ones, and the `latest` alias
is not what release builds read. The blast radius is bounded (docs are read-only context for the
assistant, and a bad bundle degrades answers rather than breaking the IDE), which is why this is
recorded rather than solved here. If that calculus changes, the two candidate levers are a revocation
marker object the cache checks before serving, or a setting that forces web fallback. **Owner: revisit
at the point the assistant's answers depend on bundled docs for anything load-bearing.**

### Retry throttling

One attempt per trigger, with no in-session backoff loop. We do not re-attempt within a session
except on an `ai.enabled` flip.

Across sessions, throttling is **deliberately scoped to hard failures only**:

- **Hard failures** (network, DNS, connection, 5xx, disk) set `lastFailureAt` and are not retried for
  1 hour. This stops a persistent CDN or configuration problem turning into a per-launch request from
  every install at once, which is the realistic sustained-load risk.
- **The 404 convergence check is never throttled.** A `fallback` install `HEAD`s the exact URL on
  every launch, as designed. Throttling it would mean an install could sit on a known-wrong docs
  version longer than necessary, which is exactly the behaviour the fallback policy exists to
  prevent. A `HEAD` is a few hundred bytes; the cost does not justify weakening convergence.

`lastAttemptAt` records every attempt for diagnostics; `lastFailureAt` is the field the throttle
actually reads. Keeping them separate avoids a bug where a successful 304 silently suppresses the next
convergence check.

### Observability

Logging goes through the extension-host `ILogService`, prefixed `[positron-docs]`: info for the
resolved URL, version, decision (cache hit, 304, downloaded) and timing; warn for validation and
schema problems; no error level, since nothing here is user-actionable.

**The launch trigger logs how long it waited for its anchor.** Without it, the difference between a
correctly-anchored fetch and a construction-anchored regression is invisible in the field, since both
produce the same download line. Upstream already logs `Eager extensions activated` at info
(`extHostExtensionService.ts:835`), so the two timestamps together show whether the fetch landed after
the burst. Note they can legitimately disagree: that upstream line comes off the uncapped barrier while
our anchor is the 10-second-capped race, so on a hung eager extension the fetch is expected to run
*before* it.

**Where to read it.** The shared extension-host channel in the Output panel, filtered on
`[positron-docs]`. Its name depends on where the extension host runs, which for this feature means the
name differs between desktop and Workbench (`extHostLogService.ts:20`):

| Setup | Output dropdown entry | Logger id |
|---|---|---|
| Positron Desktop, local | Extension Host | `exthost` |
| Workbench, remote SSH, dev container | Extension Host (Remote) | `remoteexthost` |
| Web worker extension host | Extension Host (Worker) | `workerexthost` |

In Workbench the log is on the **server's** filesystem, under `<logsHome>/exthost/`, following the
extension host as the rest of the feature does. Everything here is info level, so the default log
level is sufficient.

**No dedicated Output channel.** At roughly one line per session (one attempt per trigger, no
in-session backoff), a permanent dropdown entry would be mostly empty, and an empty channel is harder
to draw conclusions from than a filtered busy one. The `[positron-docs]` prefix is what makes filtering
work, and it is why the prefix is specified rather than optional. Revisit only if per-operation logging
arrives with the telemetry follow-up and volume actually grows.

**No telemetry event in v1**, but tracked with an owner and a target release rather than left open --
see "Tracked follow-up: telemetry" under Rollout.

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
- `sha256` mismatch: rejected, previous cache intact
- sidecar `404`, and sidecar present but unparseable: both rejected without extracting, previous cache
  intact
- zip entry escaping the target: rejected
- oversize download: aborted
- two concurrent `ensure()` calls: one download
- **cache-present rule:** for each failure kind (network, 5xx, corrupt zip, `schema` mismatch,
  `sha256` mismatch, missing sidecar, disk error), a warm cache is still served and only a cold cache yields
  `undefined`. This is the finding that broke the first draft, so it gets explicit per-kind coverage
  rather than one representative case.
- hard failure sets `lastFailureAt` and is not retried within the throttle window
- a `404` on exact is **not** throttled: two consecutive launches both `HEAD` the exact URL
- prune leaves a `.tmp-*` with a recent mtime alone, and deletes one older than 10 minutes

The convergence tests assert **intermediate** state, that the fallback bundle was actually served
before convergence, not only the final exact result. A test that checked only the end state would
pass even if the fallback never worked.

**`src/vs/workbench/api/test/node/positron/extHostDocsNode.vitest.ts`** (matching the existing
`api/test/browser/positron` and `api/test/common/positron` convention) - the trigger logic, with
`stubInterface` for init data and configuration:

- `ai.enabled === false` at launch: scheduler fires, `ensure()` never called
- `ai.enabled` false to true: `ensure()` called once
- the launch scheduler is armed only after the startup-finished signal resolves, and does not fire
  while that signal is pending. This is the anchor assertion: a construction-anchored regression would
  fire the scheduler with the signal still outstanding, and nothing else in the suite would notice
- a startup-finished signal that never resolves leaves `ensure()` uncalled from trigger 1 while
  `getLocalDocs()` still works, documenting that trigger 3 is the backstop for a wedged anchor
- `POSITRON_LLMS_DOCS_URL` set: it takes precedence over the `product.json` value, **and `ensure()` is
  still called** with the overridden URL. Asserting the second half is what stops the dropped skip rule
  being reintroduced silently, since URL priority alone passes either way
- `getLocalDocs()` during an in-flight fetch: joins, does not start a second
- constructing the service performs zero port calls, asserting the failure-isolation discipline that
  is the one risk specific to this placement

### What we deliberately do not test

**No extension-host Mocha test.** The API surface is a one-line delegation; an activated extension
host would reveal nothing the unit tests do not.

### Integration coverage

Vitest drives the state machine through fake ports and the website guards check the bundle at publish
time, so both sides are tested against a *model* of the other. Nothing exercises real HTTPS, real
`base/node/zip.ts` extraction, a real digest over real bytes, or real writes to the real cache path.

The v1 E2E asserts on the filesystem rather than on the UI, because there is no UI yet -- nothing is
rendered, and no command or view exposes local docs. Once the assistant reads the bundle (Step 3) the
same test extends to a genuine user-visible assertion: ask a question, see a cited local doc.

**One gating E2E, `--project e2e-electron`.** A local static server serves a hand-made bundle plus its
sidecar; the app launches with `POSITRON_LLMS_DOCS_URL` pointed at it and `ai.enabled` set pre-launch
via `beforeApp`; the test polls for the extracted cache. Real client machinery, no network dependency.
Asserts intermediate state, not just that a directory appeared: `bundle.json` parses with
`schema === 1`, the extracted count matches `fileCount`, and `state.json`'s version matches the
directory name.

Needs two new pieces of harness: a worker option surfacing `extraEnv` (plumbed at
`test/e2e/infra/code.ts:68` but not exposed to tests -- follow the `extraSettings` pattern in
`test/e2e/tests/notebooks-positron/_test.setup.ts:18`), and a local HTTP server fixture, which no E2E
in the suite has today. `beforeApp` and the `userDataDir` fixture already exist.

**One scheduled contract check, non-gating.** `scripts/check-docs-bundle-contract.mts` fetches the real
published `latest` bundle for both profiles and runs the consumer's own `parseManifest()` against it,
plus digest and `fileCount`. It lives in Positron because the point is running real consumer code
against the real artifact; a script rather than a `.vitest.ts` because `vitest.config.ts:10` has no
opt-out glob and it would otherwise run on every PR. Weekly workflow with `workflow_dispatch`, notify
on failure.

**Not covered: Workbench.** `e2e-workbench` would exercise a different profile (hence a different CDN
object), a server-side cache path, and env inheritance through the extension-host spawn. Deferred
because that project needs `extraEnv` reaching the container, `docker exec` assertions, and a
container-reachable fixture server. Manual step 7 covers it until the assistant-reads-docs E2E needs
the same harness.

### Manual validation

The CDN integration is covered by the scheduled contract check above. What stays manual is the
behaviour no automated check reaches -- multi-window races, mid-session toggles, and Workbench
placement:

1. Dev build: confirm `latest-by-policy`, cache at `<userdata>/User/positron-docs/<version>/`, and a
   log line showing the resolved URL and decision. Logs are in the extension-host Output channel
   filtered on `[positron-docs]` -- see "Observability" for which channel, since steps 7 and 8 read a
   different one than the desktop steps.
2. `ai.enabled: false`: confirm no network egress and `getLocalDocs()` returning `undefined`.
3. Flip `ai.enabled` on mid-session: fetch fires without a reload.
4. Delete the cache mid-session, call `getLocalDocs()`: lazy re-fetch, and a second concurrent call
   joins it.
5. Point the bundle base URL at a local static server serving hand-made bundles: drive the 404, exact,
   fallback, 304, sidecar-404, and digest-mismatch transitions without waiting on a release cycle.
   This is what makes the feature verifiable on demand, and the happy path of it is what the gating
   E2E automates -- the transition matrix stays manual until someone wants it parameterised.
6. Two windows open at once against a cold cache: confirm one usable bundle, no spurious failure from
   the prune race.
7. Workbench: profile resolves to `workbench`, and the cache lands on the server's filesystem where
   the remote extension host can read it. **This is the one step with no automated backstop.**
8. `POSITRON_DOCS_URL` set with the bundle URL left at its default: confirm the fetch still runs and
   local docs still land, since the skip rule is gone.
9. Cold start on a large workspace with Python and R discovery both running: confirm the
   `[positron-docs]` fetch line lands after upstream's `Eager extensions activated` line, not during
   the burst. This is the anchor check, and it needs a slow real startup -- the unit test proves the
   scheduler is armed off the signal, but only a real cold start shows the ordering that motivated it.

**Step 5's local server must host the sidecars too.** For every `<name>.zip` it serves it needs a
`<name>.zip.sha256sum` next to it, containing that zip's hex digest -- the same naming as Step 1's
objects. Without them every request lands on the sidecar-404 path and `getLocalDocs()` returns
`undefined` with only a warn log to explain it, which reads as "the feature is broken" rather than
"the fixture is incomplete". Generating a fixture is one `shasum -a 256` per zip; omitting one on
purpose is how you drive the sidecar-404 and digest-mismatch transitions.

**Step 5 needs a runtime override to be worth anything.** `product.json` is baked at build time, so
overriding `positronLlmsDocsUrl` would otherwise require a custom build -- which contradicts the
claim that this makes the feature verifiable on demand. So PR 2b must also honour a
`POSITRON_LLMS_DOCS_URL` environment variable, read from `process.env` in the extension host and
taking precedence over the `product.json` value. An env var rather than a setting keeps it out of the
Settings UI (this is a test and air-gapped-admin knob, not a user preference) and matches how
`POSITRON_DOCS_URL` is already plumbed for the docs site. This is a prerequisite for merging PR 2b,
not a follow-up.

## Rollout

1. **Website PR (Step 1).** Slim bundles, digest sidecars, `latest` aliases, and the guards.
   Independently shippable, adds four CDN objects per profile, changes nothing existing. Must land and
   run once before the Positron side is verifiable against the real CDN; manual validation step 5
   unblocks local work in the meantime.

2. **Positron PR 2a: the platform module.** `positronDocsBundle.ts`, `positronDocsPorts.ts`,
   `positronDocsCache.ts`, and all the Vitest coverage. Zero wiring, zero registration, nothing
   instantiated at runtime -- the code is unreachable until 2b lands, so it can be reviewed purely on
   its own merits.

3. **Positron PR 2b: the extension-host wiring.** `extHostDocs.ts`, `extHostDocsNode.ts`, the two
   `registerSingleton` lines, `positron.d.ts`, `product.json`, and the `POSITRON_LLMS_DOCS_URL`
   override. Small enough to review as a diff.

4. **Positron PR 2c: the gating E2E.** The local-server fixture, the `extraEnv` worker option, and the
   one `e2e-electron` test. Separate from 2b because it adds shared E2E harness that outlives this
   feature, and a review round on new test infrastructure should not hold up the wiring. **Must not
   merge before 2b** -- the test asserts behaviour 2b introduces, so merging it first turns the gating
   suite red for everyone.

5. **Contract-check PR.** `scripts/check-docs-bundle-contract.mts` plus the weekly workflow. Depends on
   the website PR having published at least once, so it lands last. Non-gating, so it can land after 2b
   without blocking anything.

6. **Assistant PR (Step 3).** Out of scope here, unblocked by the handover contract below.

Splitting 2a from 2b matters because the convergence state machine and the extraction security checks
are the highest-risk code in the change, while the wiring is mechanical. Bundled together, a review
round on the state machine blocks the wiring, and the security-relevant diff competes for attention
with `registerSingleton` lines. The seam already draws the line, so the PR boundary is free.

**No new user-facing setting in v1.** `ai.enabled` is the documented single main switch for AI
features and adding a second dilutes it, and `POSITRON_LLMS_DOCS_URL` covers the air-gapped
Workbench case. Revisit only if a customer asks for a desktop-side opt-out.

### Tracked follow-up: telemetry

Deferring telemetry is a decision with an expiry date, not an open question. Without a
cache-hit-versus-web-fallback event we cannot tell whether the exact-on-releases policy leaves release
users on web docs longer than expected -- which is exactly what would happen if the manual docs
publish at release-process step 7 is routinely delayed. **Add a single counter distinguishing "served
local" from "fell back to web", with the `resolution` value attached, in the release after this
ships.** Recorded in the project backlog so it does not depend on anyone remembering.

## Handover contract for the assistant (posit-dev/assistant)

Written down so the assistant repo can proceed independently:

- **Feature-detect:** `typeof positron.docs?.getLocalDocs === 'function'`. The assistant ships on its
  own cadence and will run on Positron builds that predate this API.
- **Call `positron.docs.getLocalDocs()` per docs need.** Results are cached in-process, so repeat
  calls are free. `undefined` means today's web behaviour, unchanged.
- **On a result,** read `<path>/llms.txt` for the index. Its links are bundle-relative paths; read
  the named `.llms.md` files with ordinary filesystem APIs.
- **To cite a web link,** join `docsBaseUrl` with the relative path and swap `.llms.md` for `.html`.
- **Refuse the bundle** if `schema` is not a version it understands. Today this is future-proofing
  rather than an active check: core's `parseManifest()` rejects `schema !== 1` first, so the assistant
  can only ever observe `1`. Keep it anyway -- the assistant ships independently and may run against a
  core that has relaxed the check to a range (see "Schema versioning policy").
- **Caveat answers** when `isExactMatch === false`.

## Non-goals

- No change to `IPositronDocsService` or its five existing URL consumers.
- No baked installer snapshot (spike option B) and no hybrid (option C).
- No local docs for Help, the welcome page, or release notes. Those stay on the web, and would need
  the full bundle or a Markdown renderer anyway.
- No handling of the existing 67MB full bundles.
- No telemetry in v1 (tracked as a follow-up for the next release, not indefinitely deferred).
- No new user-facing setting.
