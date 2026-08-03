# llm-docs manual QA harness

Exercises the local-docs bundle pipeline against a running Positron, without
touching the real CDN. This is the harness behind PR #15251's validation table,
kept in the repo so the table stays reproducible.

- `server.mjs` - fixture CDN, serves the same URL shapes as cdn.posit.co
- `ext/` - throwaway extension that calls `positron.docs.getLocalDocs()`

Nothing to install: `server.mjs` has no dependencies and the extension is plain
JavaScript. Nothing here ships - it is not in any build glob and no product code
references it.

## Run

Terminal 1 - the fixture CDN:

```bash
node test/manual/llm-docs/server.mjs
```

Terminal 2 - Positron, pointed at it. Use a throwaway user-data-dir: the docs
cache lives inside it, so a dedicated one keeps QA state out of your real
profile and lets you reset by deleting a directory.

```bash
POSITRON_LLMS_DOCS_URL=http://127.0.0.1:8099 \
  ./scripts/code.sh \
  --user-data-dir /tmp/positron-docs-qa \
  --extensionDevelopmentPath "$PWD/test/manual/llm-docs/ext" \
  --log info
```

`--log info` matters: every decision is logged at info, so without it the
Output pane shows nothing and you are guessing.

## Where to look

| What | Where |
|---|---|
| Decisions | Output > Extension Host, filter `[llm-docs]` |
| Results, state, requests | Output > Docs QA |
| Cache | `/tmp/positron-docs-qa/User/positron-llm-docs/` |
| Recorded state | `.../positron-llm-docs/state.json` (`resolution`, `etag`, `lastError`) |
| What the client asked for | `curl localhost:8099/_ctl/log` |

The Docs QA channel summarises the last three of those, so the only pane you
normally need beside it is Extension Host - that is where the `[llm-docs]`
decisions land, and the extension cannot read them.

`state.json` is worth watching directly - `resolution` and `lastFailureAt` are
not on the public API, so it is the only place to see fallback vs exact and
whether the failure throttle armed.

Note that Positron writes its logs under `~/.local/state/positron/logs/`, not
inside `--user-data-dir`, if you would rather grep
`window1/exthost/exthost.log` than use the Output pane.

## Scenarios

**Docs QA: Run Scenario** is the whole loop in one command. Pick a scenario from
the list and it switches the fixture, deletes the cache directory, clears the
server log, clears the in-process memo, calls `getLocalDocs()`, and prints the
expectation next to what actually happened:

```
scenario  digest-mismatch
expect    rejected, "digest mismatch" logged
cleared   /tmp/positron-docs-qa/User/positron-llm-docs
memo      invalidated via an ai.enabled off/on flip
result     1289ms  undefined
disk      state.json
state     resolution: latest-by-policy, version: -, lastError: digest mismatch ...
server    15:31:02  GET /positron-llms-latest.zip
          15:31:02  GET /positron-llms-latest.zip.sha256sum
```

It reports; it does not assert. Read the `[llm-docs]` decisions in Output >
Extension Host and compare against `expect` yourself.

The scenario list, and the expectation for each, lives beside the behaviour in
`server.mjs` - the picker reads it over `/_ctl/scenarios`, so
`curl localhost:8099/_ctl/scenarios` gets you the same list from a terminal.

### Doing it by hand

Only needed for the release-build cases below, where you are driving
`product.json` as well. Three steps, and skipping any one of them will show you
a stale result and let you conclude the scenario passed:

```bash
curl localhost:8099/_ctl/scenario/digest-mismatch
rm -rf /tmp/positron-docs-qa/User/positron-llm-docs   # cache and failure throttle
curl localhost:8099/_ctl/reset                        # request log
```

Then, in Positron: toggle `ai.enabled` off and back on, and run **Docs QA: Get
Local Docs**. The toggle is what clears the in-process memo - deleting the cache
directory does not, because `PositronDocsCache` remembers the first completed
attempt per window and only `invalidate()` clears that. The toggle is also
trigger 2, so it is worth exercising anyway.

## Other commands (Command Palette)

- **Docs QA: Get Local Docs** - calls the API, reports the result and elapsed ms
- **Docs QA: Get Local Docs Twice Concurrently** - single-flight check; expect
  one GET in the server log, two callers served
- **Docs QA: Open the Cached llms.txt** - proves the returned path is real

## Scenarios this cannot reach as a dev build

`product.json` has no `quality` field in a dev build, so `initData.quality` is
`undefined` and resolution is always `latest-by-policy`. The release-only paths
- `exact`, `fallback`, the HEAD convergence probe, and superseded-directory
cleanup - need:

```bash
# temporary, do not commit
npx json -I -f product.json -e 'this.quality="releases"'
```

Then the exact URL is built from your build's version, so set the fixture's
notion of "published" accordingly. `exact-published` serves any exact version
that is asked for, so it will resolve `exact` immediately; the default
scenarios 404 on exact, which is the `fallback` case.

Revert `product.json` when you are done - a committed `quality` field changes
update-channel behaviour well beyond this feature.

The `workbench` profile also cannot be reached here: it keys off
`RS_SERVER_URL`, so it needs a Workbench container. That row is untested in the
PR table for the same reason.

## The failure throttle will bite you

If the fixture server is not running when Positron tries to fetch, that is a
hard failure, and a hard failure suppresses the next attempt for an hour
(`DOCS_FAILURE_THROTTLE_MS`). The log says so:

```
[llm-docs] skipping fetch; a hard failure is still inside the throttle window
```

`lastFailureAt` lives in `state.json`, so neither toggling `ai.enabled` nor
relaunching Positron shortens the wait - `invalidate()` clears the in-process
gate only. Deleting the cache directory is what clears it, which **Docs QA: Run
Scenario** does on every run, so it is only a trap if you are driving the fixture
by hand. Start the server before Positron either way.
