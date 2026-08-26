# Memory metrics: server lane

Design for [#15493](https://github.com/posit-dev/positron/issues/15493), part of
epic [#15001](https://github.com/posit-dev/positron/issues/15001).

## Status: the lane is built but not scheduled

Everything below is implemented except the nightly job itself. A released
`positron-server` will not start without a license key signed by the production
issuer, and no CI lane has that key, so there is no server matrix row and
`EXPECTED_SCENARIOS_BY_LANE.server` is empty. The lane dimension, the partitioned
report and `memory-server-idle.test.ts` all landed: restoring the lane means
restoring that entry and the matrix row together.

The evidence and the three options for getting a licensed server into CI are on
[#15493](https://github.com/posit-dev/positron/issues/15493#issuecomment-5424957294).
Read that before acting on the sections below.

## Problem

Every memory scenario we measure is Electron desktop. The collector takes its
root pid from the Electron main process, which does not exist in the server
lane, and the spec asserts as much:

```ts
const mainPid = app.code.electronApp?.process().pid;
expect(mainPid, 'no Electron main pid; this spec only runs against Electron').toBeTruthy();
```

So we have no measurement at all of `positron-server`, which is where the
largest single number in the memory keynote lives: roughly 500 MB of extra
baseline with a 638 MB extension host. Desktop is now reasonably well covered --
ark, kallichore, the Quarto LSP, ruff, air, pet, the duckdb worker and the AI
extensions are all measured or accounted for -- and the server lane is the
remaining blind spot.

"Total" also means something different there. The renderer and GPU processes run
in the user's browser, outside the server's process tree entirely, so a server
total is not comparable to a desktop total and must never be differenced against
one.

## There is no existing published data

Worth stating before anything else, because it removes a whole class of concern.
`MEMORY_PUBLISH` is hardcoded `'false'` in the nightly workflow
(`.github/workflows/test-memory-metrics.yml:170`), and the `/memory` endpoints are
still unmerged. **Nothing has ever been published.** So adding `lane` to the series
key orphans no history, needs no backfill, and cannot regress desktop trend
detection -- there is no desktop trend yet. Confirmed with the endpoint's
implementer that #220 has had no production or staging deploy, which is also what
licenses tightening `BaselineResponse` below.

This stops being true the moment the endpoint deploys and the nightly flips
`MEMORY_PUBLISH` to `'true'`. Any later change to the series key does need a
migration story.

## Decisions

| Question | Decision |
| --- | --- |
| Which artifact | `positron-server`, not `positron-reh` or `positron-workbench` |
| Scenario scope | `idle` only |
| What the total covers | Server-side process tree only |
| How lanes are modelled | A `lane` field, not lane-encoded scenario names |
| Report structure | One summary page, partitioned by lane |
| Cross-image baselines | Filtered API-side, with a reason on miss (Option C) |

### `positron-server`

The release publishes three server-side tarballs: `positron-server` (the web-UI
backend), `positron-reh` (the remote extension host, used by Remote SSH, no web
UI) and `positron-workbench` (the Posit Workbench variant). The keynote's number
is `positron-server`, and the e2e infrastructure already knows how to drive it.
The other two are separate questions and should get their own issues if anyone
wants them.

### `idle` only

Not caution -- the desktop scenarios measure the wrong thing in this lane. Our
own cross-scenario finding is that `notebook`, `editors` and `console-output`
put about 90% of their cost in the **renderer**, which is not in the server's
process tree. Mirroring those three would measure roughly the leftover 10% of
each, at a cost of three more nightly jobs and three more thresholds in #15496.

`idle`'s cost in this lane is almost entirely server-side, and it is exactly the
claim we want to check. It is the scenario where the server lane has something
to say.

### Server-side tree only

We root the walk at the server process and report that. We do **not** try to
approximate a whole-system total.

A convenient property falls out: because the walk is rooted at the server's own
pid, the Playwright Chromium driving the page is a *sibling* process rather than
a descendant, so it is excluded automatically. No filtering, and no risk of
publishing our own test harness's memory as Positron's.

Reading the workbench page's JS heap over CDP would recover some renderer
signal, and is arguably more valuable in this lane than on desktop since it is
the only renderer visibility available. It is deliberately **out of scope**: it
is a second measurement mechanism (CDP rather than procfs) that would apply to
desktop too, and bundling it here means one PR delivers two new capabilities and
neither gets reviewed properly. File it as a follow-up.

### `lane`, not lane-encoded scenario names

`lane` is a first-class field, `'desktop' | 'server'`, and part of the published
series key alongside `scenario` and `branch`. Scenario names stay
lane-independent: the server run measures scenario `idle` in lane `server`, not
a scenario called `server-idle`.

This matters for two reasons. `MEMORY_SCENARIOS` is a published contract whose
own comment warns that renaming an entry splits its history in two, and keeping
the seven strings untouched avoids that entirely. And the insights API's series
key is already `scenario x branch x lane`, agreed before this design; encoding
the lane in the scenario name too would make `lane` derivable and put the same
fact in two places.

Consequence: artifact names must become lane-qualified
(`memory-report-<lane>-<scenario>`), because otherwise two jobs in one run would
both be `memory-report-idle` and collide.

The lane appears in two places for two different reasons, and only one is
authoritative. `MemorySnapshot.lane` is the source of truth that the summary
partitions on. The lane in the artifact directory name exists solely to keep two
jobs from colliding, and `summarize-cli.ts` parses it only to locate files -- it
must not be trusted over the snapshot's own field, so that a renamed artifact can
never silently reclassify a measurement. Concretely: the directory path is
consumed to locate files and discarded *before* any `MemorySnapshot` is
constructed, so no code path can leave a path-derived lane on the object.

## Implementation

### Root pid selection

`Code` already stores the server's `ChildProcess` in the same `mainProcess` slot
Electron uses (`code.ts:158` passes `serverProcess` there; `:180` declares it),
but the field is `private`. Add a lane-agnostic public accessor:

```ts
get rootPid(): number | undefined {
    return this.electronApp?.process().pid ?? this.mainProcess?.pid ?? undefined;
}
```

`code.ts` is an upstream file, so wrap this in the existing
`// --- Start Positron ---` markers already around `mainProcess`.

The spec's Electron-only assertion becomes a lane-agnostic one: a root pid is
required, and which process supplies it is the lane's business.

### Lane plumbing

- `MEMORY_LANES = ['desktop', 'server'] as const`, with `MemoryLane` derived from
  it, mirroring how `scenarios.ts` derives `MemoryScenario`.
- `MEMORY_LANE` environment variable, defaulting to `desktop` when unset, so
  every existing invocation keeps working untouched.
- `lane` added to `MemoryPayload` and to `MemorySnapshot`.
- Which spec runs is now keyed on the lane/scenario pair, so
  `memorySpecsToIgnore` takes both. The lane parameter is **required, with no
  default**: every existing call site is updated to pass `'desktop'` explicitly.
  A default would let a missed call site silently produce a lane-filtered ignore
  list where the old code meant a lane-agnostic one, and the compiler would not
  catch it.

### Workflow

The matrix becomes an explicit `include` list of lane/scenario pairs rather than
a bare scenario list. The server job additionally:

- downloads `positron-server-linux-<arch>-<version>.tar.gz` rather than the
  Electron tarball, extracts it, and sets `VSCODE_REMOTE_SERVER_PATH` to the
  extracted directory, which is what `resolveServerLocation`
  (`playwrightBrowser.ts:120`) reads to run a built server instead of the
  source script
- runs with `PW_PROJECT_NAME: e2e-chromium` instead of `e2e-electron`

### Which Playwright project, and why not a new one

**Reuse `e2e-chromium`. Do not add a project, and do not use `e2e-server`.**

`e2e-server` cannot work. It sets `useExternalServer: true` against
`http://localhost:8080`, which routes through `launchPlaywrightExternalServer`,
and that path constructs `Code` with `null` in the process slot (`code.ts:149`).
The server it talks to was started outside Playwright, so the harness has no
handle on it, `rootPid` returns `undefined`, and the collector has no tree. It
would not fail loudly either -- it would produce an empty process list, a run
that looks like it worked.

The spawned path is the one we need: `web: true` (which is just `!!browser`,
`options.fixtures.ts:73`) with `useExternalServer` unset routes through
`launchPlaywrightBrowser`, which spawns the server itself and passes the
`ChildProcess` into `Code` (`code.ts:155-158`). That is what makes `rootPid`
work, and what honours `VSCODE_REMOTE_SERVER_PATH`.

`e2e-chromium` is exactly that: `browserName: 'chromium'`, no
`useExternalServer`. So it needs no new project, only the same guard
`e2e-electron` already carries.

Blast radius is small because `@:web` selects into **only two** projects,
`e2e-chromium` and `e2e-server`. The other browser lanes select on
`@:cross-browser`, so they are unaffected. Concretely:

- tag the server memory spec `@:web`, which is simply true of it
- add `...memorySpecsToIgnore(...)` to both `e2e-chromium` and `e2e-server`, so
  the spec is inert unless the memory workflow selects it. `e2e-electron` already
  does this (`playwright.config.ts:112`); this extends an existing pattern rather
  than inventing one, and the `e2e-server` entry is what stops the broken
  external-server path from ever picking it up.

The trade-off accepted here: the memory job now shares a project name with a real
web CI lane, so `e2e-chromium`'s `use` block (notably `headless: false`) applies
to memory runs too. That is fine for this lane -- the renderer is in the browser
and outside the tree we measure, so browser-side window configuration cannot move
the number.

### Forced GC in the server lane

Desktop forces a GC in the shared process and extension host over CDP before
sampling, so figures reflect what a scenario retains rather than whether V8 had
swept yet. The server lane does the same, but reaches the inspector by a different
route.

The desktop route does not work here. The inspector flags travel as `extraArgs`,
which only `electron.ts:95-96` consumes; `playwrightBrowser.ts` builds its own
argument list and ignores them, which is why the existing wiring gates them on
`!browser` (`options.fixtures.ts:94`). Plumbing `extraArgs` into the server launch
is not the answer either -- the remote extension host is not a child of the server
CLI's argument list; the client asks for it.

The working route is the **workbench payload**, and the whole chain already
exists:

1. `playwrightBrowser.ts:229-234` already appends a `payload=` array to the
   workbench URL, today carrying `["logLevel", ...]`. Add
   `["inspect-extensions", "5870"]` to it for the server memory lane.
2. `WorkspaceProvider` parses `payload` from the URL query
   (`workbench.ts:422`, `:468`).
3. `BrowserWorkbenchEnvironmentService` maps the `inspect-extensions` key onto
   `debugExtensionHost.port` (`environmentService.ts:420-421`).
4. The client passes that as `startParams.port` when it asks the server to start
   the remote extension host (`remoteExtensionHost.ts:112`).
5. The server spawns the extension host with `--inspect=<port>`
   (`extensionHostConnection.ts:311-314`).
6. `gc.ts` connects to `localhost:5870` and collects, unchanged. The server runs
   in the same container as the test, so the port is reachable.

So one entry in an existing array, following a pattern already there, rather than
new launch plumbing.

Two consequences to get right:

- **`GC_TARGETS` must become lane-aware.** The desktop list has two entries,
  `shared` and `extension_host`. There is no shared process in the server lane at
  all -- it is an Electron concept -- so the server target list is
  `extension_host` only. Attempting the shared-process port would fail on every
  run and, worse, invite someone to "fix" it.
- **Timing is already correct.** The remote extension host starts when the client
  connects, so the inspector port exists only after page load. The GC runs after
  settle and before sampling, which is well after that.

This also keeps the two lanes methodologically aligned rather than introducing a
difference: desktop already measures an extension host running with an inspector
attached, so doing the same on the server is consistency, not a new bias.

### Summary report

One page, partitioned by lane. Desktop scenarios are differenced against desktop
`idle`; server scenarios against server `idle`. Deltas are computed **within** a
partition and never across one -- the partition is what makes the invalid
comparison structurally impossible rather than something a reader must remember.

Today the server partition holds one column and therefore has no delta column at
all, since `idle` is its own baseline. That is sparse but honest, and it fills in
if the lane ever gains a second scenario.

The server section carries a standing note that its total is not comparable to
the desktop total, and why.

`summary.ts` currently hardcodes `idle` as *the* baseline
(`rolesByScenario.get('idle')`) and sorts columns by delta against it. That
becomes per-partition. `summarize-cli.ts`'s `scenarioFromDirName` must learn the
lane prefix.

### Cross-image baselines (Option C)

Measurements taken on different container images are not comparable. The image
tag tracks the Node version from `.nvmrc`
(`ghcr.io/posit-dev/positron-ubuntu24:24.18.0`), so every routine Node bump rolls
it -- a few times a year, and a Node bump plausibly moves memory for real, which
is precisely when a fake delta is most confusing.

The image value comes from the `MEMORY_CONTAINER_IMAGE` workflow environment
variable (`test-memory-metrics.yml:18`), which is already what `publishSnapshots`
sends on the POST. Both sides of the round trip must read that same variable: a
baseline written under one derivation and queried under another would never match,
and the failure would look like a permanently missing baseline rather than a bug.

The baseline request gains `lane` and `container_image`:

```
GET /memory/baseline?scenario=idle&branch=main&lane=server&container_image=<image>
```

The API returns the newest baseline matching all four, and never falls back to a
different image. On a miss it returns a reason:

```ts
| { found: false; reason: 'no_baseline' }
| { found: false; reason: 'image_mismatch'; available_container_image: string }
```

`fetchBaseline` must also **log the status and body of any non-2xx response**. It
currently returns `undefined` silently on `statusCode >= 400` (publish.ts:280-282)
while only the `catch` path logs, so a rejected query is today indistinguishable
from an empty store. This matters because `lane` is a closed enum and the API
rejects an invalid one with a 400: without this logging that 400 is invisible, and
a typo in the query builder would read as a permanently missing baseline -- exactly
the failure mode called out for the image derivation above. Note the asymmetry is
deliberate: an invalid `lane` is a 400 because no legitimate query produces one,
whereas an unknown `container_image` stays a `{found:false}` because it is an open
set of strings and "no match" is a real answer.

We log the reason. No new rendering: `{found: false}` already renders absolute
numbers with no delta column, which is the correct presentation for "there is no
comparable baseline". The reason exists because a bare `{found: false}` cannot
distinguish an image roll from broken publishing from a first-ever run.

The API-side filter is tracked separately on the insights repo. If
`container_image` is absent from the query the API does not filter, so it can
ship before Positron starts sending the parameter.

### Two correctness fixes riding along

**Publish precondition.** The invariant "only settled snapshots publish" is real
but rests entirely on undocumented statement ordering: the spec's quality gates
happen to run before `writeFileSync`, and the publish step happens to require all
three launch files. Enforce it where it matters instead -- `publishSnapshots`
refuses any snapshot whose `stoppedGrowing` or `treeSettled` is not true. This
replaces an earlier proposal to publish those flags as payload fields, which was
withdrawn: a field that is `true` by construction carries no information, and
recording a violation is weaker than refusing to send it.

**Validate `activation_event` rather than cast it.** `baselineToSnapshot` reads
`e.activation_event ?? null`, which defends against absence but not against the
wrong type. A serializer bug on the API side briefly returned `{}` for null,
which would have passed straight through into a field typed `string | null` and
inverted the `baselineKnowsEvents` guard in `render.ts`, making every eagerly
activated extension read as newly eager every night. The same function already
validates `process_role` rather than casting it, with a comment describing this
exact failure mode; `activation_event` should match:

```ts
activationEvent: typeof e.activation_event === 'string' ? e.activation_event : null
```

Also tighten `BaselineResponse`: the provenance fields (`container_image`,
`run_id`, `app_version`, `lane`) become required, and `activation_event` becomes
required-but-nullable. The optionality was defensive against endpoint versions
that never shipped -- the endpoint is not deployed, so there is no released shape
to stay compatible with.

## Packaging

This ships as **one PR**, including the two correctness fixes above. They are
strictly speaking adjacent rather than part of the server lane, and splitting them
out was considered and rejected: they are small, they are already reviewed in
design here, and the `activation_event` fix wants to be in before the endpoint
deploys.

## Testing

Vitest, in `test/e2e/utils/memory/`:

- lane plumbing: `MEMORY_LANE` default, unknown value rejected, `memorySpecsToIgnore`
  over lane/scenario pairs
- summary partitioning: deltas computed within a lane; a server column never
  differenced against desktop `idle`; a single-scenario partition renders no
  delta column
- `publishSnapshots` refuses an unsettled snapshot, and publishes a settled one
- `baselineToSnapshot` maps `{}`, `null`, absent and a real string for
  `activation_event` onto `string | null`
- baseline query construction includes `lane` and `container_image`
- both `{found:false}` reasons parse and log

Real verification is a `workflow_dispatch` of `Test: Memory Metrics`, as with
every previous scenario PR: these specs only collect when `MEMORY_SCENARIO` is
set and no PR tag runs them.

**A dispatch cannot exercise the publish path, so it is not sufficient on its
own.** Two independent reasons: `apiUrl()` routes any branch other than `main` to
`LOCAL_API_URL`, and the workflow hardcodes `MEMORY_PUBLISH: 'false'`. So the
first POST ever to carry `lane=server` would otherwise be a live main-branch
nightly, after both the endpoint deploy and the `MEMORY_PUBLISH` flip, with
nothing having exercised it first.

Required extra step: hand the first dispatch's server-lane snapshot artifacts to
the insights implementer, who rebuilds the payload field-for-field from
`buildPayload` and POSTs it to the real API -- the same replay already done for
two real desktop nights. That verifies the storage layout, lane isolation,
baseline shape and image guard for `lane=server` before it ever runs in
production. Do not consider this design verified without it.

## Risks and unknowns

- **Whether `positron-server` runs in the memory container at all** is unverified.
  It needs a connection token and a Playwright Chromium in the same container.
  Expect the first dispatch to surface wiring problems, as the desktop lane's
  first CI run did.
- **Server-lane noise is uncharacterised.** Desktop needed four runs and a forced
  GC pass before its spreads were understood. Do not set any threshold for this
  lane until several nightlies exist.
- **The server GC route is traced in code but not yet run.** Every link exists
  (see "Forced GC in the server lane"), but nothing has exercised the chain end to
  end. If the inspector does not come up, server extension-host figures carry the
  ~40 MB of uncollected startup garbage the desktop lane used to, and the series
  is correspondingly noisier. Detect it rather than assume it: assert the forced-GC
  stats are present for the server lane, so a silently-absent GC fails the run
  instead of quietly publishing a noisier number.
- **The keynote's 638 MB is unverified.** This design exists to check it, not to
  confirm it. A materially different number is a finding, not a bug in the
  harness.

## Out of scope

- CDP browser JS-heap measurement (its own follow-up)
- `positron-reh` and `positron-workbench`
- Mirroring desktop feature scenarios into the server lane
- Any threshold or alerting for the server lane (#15496)
