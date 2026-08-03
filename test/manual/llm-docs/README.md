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
| Cache | `/tmp/positron-docs-qa/User/positron-llm-docs/` |
| Recorded state | `.../positron-llm-docs/state.json` (`resolution`, `etag`, `lastError`) |
| What the client asked for | `curl localhost:8099/_ctl/log` |

`state.json` is worth watching directly - `resolution` and `lastFailureAt` are
not on the public API, so it is the only place to see fallback vs exact and
whether the failure throttle armed.

## Commands (Command Palette)

- **Docs QA: Get Local Docs** - calls the API, reports the result and elapsed ms
- **Docs QA: Get Local Docs Twice Concurrently** - single-flight check; expect
  one GET in the server log, two callers served
- **Docs QA: Open the Cached llms.txt** - proves the returned path is real

## Scenarios

Switch without restarting Positron:

```bash
curl localhost:8099/_ctl/scenario/digest-mismatch
```

| Scenario | Expected |
|---|---|
| `ok` | Installs, `9999.01.0-1`, `isExactMatch: false` |
| `bundle-404` | `undefined`, no version directory |
| `checksum-404` | Zip fetched, install refused, `undefined` |
| `digest-mismatch` | Rejected, `digest mismatch` logged |
| `checksum-garbage` | Rejected, `does not hold a sha256 digest` |
| `corrupt-zip` | Rejected, `corrupt archive` |
| `file-count-mismatch` | Rejected, `file-count-mismatch` |
| `evil-version` | Rejected at manifest parse; nothing written outside the root |
| `slow` | `undefined` at ~10s, download continues, next call served |
| `oversize` | Aborted, `exceeds 26214400 bytes` |
| `oversize-checksum` | Aborted, `exceeds 8192 bytes` |
| `exact-published` | Only meaningful on a faked release build - see below |

After switching scenarios, `invalidate` the in-process memo by toggling
`ai.enabled` off and back on, or the cache will keep serving what it already
has. That toggle is itself trigger 2, so it is worth exercising anyway.

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
gate only. Start the server before Positron, and if you have already tripped it,
delete the cache directory.

## Reset between runs

```bash
rm -rf /tmp/positron-docs-qa/User/positron-llm-docs
curl localhost:8099/_ctl/reset   # clears the request log
```

Do this before every scenario. Deleting the directory is what clears both the
cached bundle and the failure throttle; skip it and you will see a stale success
and conclude the scenario passed.
