# Console execution timing trace

Opt-in instrumentation for the console-execution latency investigation
(posit-dev/positron#15466). It produces a correlated per-submission timeline
across five processes so elapsed time can be attributed to a stage instead of
guessed at.

Everything here is inert unless `POSITRON_PERF_TRACE_DIR` is set. With it unset,
each marker is a property or boolean read plus the small `ids` and `attrs`
objects its caller builds, no buffer is allocated, and nothing is written.

## Fastest run

```bash
# Playwright needs the Node version pinned in .nvmrc; on a newer Node it fails
# to load its own config with a misleading "Cannot find module './lanes.js'".
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"

# The submodule build outranks the bundled binary in getArkKernelPath(), so
# building in place is what swaps the kernel. `cargo check` produces no binary,
# and a build older than the instrumentation yields a trace with no ark events.
(cd extensions/positron-r/ark && cargo build --release)

# Local, one sample of all four cases in their declared order. Set
# POSITRON_PERF_TRACE_ARK to an absolute path instead when the instrumented ark
# lives in another checkout; it pins `positron.r.kernel.path`, which outranks
# the submodule.
POSITRON_PERF_TRACE_DIR=$PWD/perf-trace \
POSITRON_PERF_TRACE_RUN_ID=local-$(date +%s) \
env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE -u BUILD \
  npx playwright test test/e2e/tests/console/performance/console-code-execution.test.ts \
    --project e2e-electron --workers 1 --reporter=list

# Ark streams its markers to a kernel log under TMPDIR, not into test-logs.
# Copy only the newest one that actually contains markers: an older run's log
# would add events that join to nothing and inflate the unattributed count.
for f in $(ls -dt "${TMPDIR:-/tmp}"/kernel-*/kernel.log); do
  grep -q PERFTRACE "$f" \
    && cp "$f" "perf-trace/ark-kernel-${POSITRON_PERF_TRACE_SAMPLE_TAG:-i1}.log" \
    && break
done

node test/e2e/utils/perf-trace/analyze.mts perf-trace
```

`env -u ELECTRON_RUN_AS_NODE` matters when the shell was launched from inside the
IDE; see `test/e2e/CLAUDE.md`.

For several local samples, re-run the whole command with a distinct
`POSITRON_PERF_TRACE_SAMPLE_TAG=i2`, `i3`, and so on. Do not reach for
`--repeat-each`: the app and sessions are worker-scoped, so repetitions execute
into the same warm console.

In CI, dispatch `.github/workflows/test-e2e-console-timing.yml`:

| Input | Meaning |
|---|---|
| `samples` | Samples per arm. 1 to smoke, 10 to compare. Each is a separate Playwright invocation, not `--repeat-each`: the app and sessions are worker-scoped, so a repetition would run the same expression into the same warm console, which breaks the spec's exact-count assertion and measures a different experiment. Failed samples are listed in `failed-samples.txt` rather than retried into ordinary ones. |
| `ark_ref` | Ark ref to build from source. Blank uses the downloaded binary. |
| `arm_label` | Label recorded in the manifest, for joining paired runs. |
| `trace` | Off gives the tracing-disabled control for measuring instrumentation overhead. |

The workflow uploads the trace directory, the analysis, the manifest, and all
logs, on failure as well as success. It performs the same kernel-log copy as the
local flow above, into `ark-kernel-<n>.log`, and reports how many logs carried
markers. A run in which no sample succeeded fails rather than publishing an
empty artifact as green.

## What gets measured

`schema.ts` is the contract: `TraceEvent` is the record shape, `TraceName` the
event catalogue, and `STAGES` the intervals the analysis reports. `analyze.mts`
imports `STAGES` from it, so adding a stage there is enough.

Correlation uses identifiers the protocols already carry, so no message format
changes and Kallichore needs no modification:

```
sample_id       harness, pushed into the renderer when a sample arms
submission_id   renderer, one per Enter
execution_id    renderer -> extension host
jupyter_msg_id  identical to execution_id, because ExecuteRequest reuses it
parent_msg_id   Ark's IOPub messages, pointing back at the submission
```

Clocks stay separate. `t_mono_us` is only ever subtracted within one process;
cross-process stages are computed from `t_wall_us` and reported as approximate.
Each process emits `clock.pair` at trace start and end, and the analysis reports
the drift between them as the uncertainty on every cross-process figure.

## Where the markers live

| Layer | Files |
|---|---|
| Harness | `recorder.ts`, `console-dom.ts`, and markers inside the real `pages/console.ts` helpers |
| Renderer | `src/vs/base/common/positronPerfTrace.ts` plus markers in the console service, console input, throttled emitter, and the runtime main-thread adapter |
| Extension host | `extensions/positron-supervisor/src/perfTrace.ts`, `extensions/positron-r/src/perfTrace.ts` and their call sites |
| Ark | `crates/amalthea/src/perf_trace.rs`, emitted as `PERFTRACE {json}` on the `perftrace` log target |

On the first R submission the harness's focus chord makes R the foreground
session, which starts the R LSP inside the measured interval. That path is
covered end to end: `ark.lsp.server.start` through `ark.lsp.initialized` and
`ark.lsp.index.warm.*` on the kernel side, `exthost.r.lsp.client.starting` and
`.running` on the client side, and `renderer.longtask` for the main-thread blocks
that would otherwise appear only as an absence of events.

Ark is enabled by log filter alone, no new environment variable: the spec sets
`positron.r.kernel.env` to `RUST_LOG=warn,ark=warn,perftrace=trace`, which
`kernel-spec.ts` spreads over `RUST_LOG`. The rest of Ark stays quiet, so the log
does not grow large enough to perturb what it measures.

## Deliberate limits

Read these before drawing a conclusion from a number.

- **DOM readiness is not paint.** The `MutationObserver` fires when a node
  enters the DOM. Nothing here measures rasterisation.
- **Kallichore is bracketed, not instrumented.** The interval between
  `exthost.supervisor.socket.send` and `ark.shell.recv` contains transport and
  scheduling as well as the server's own work. It is not Kallichore processing
  time.
- **`lsp_request_id` is unavailable.** `vscode-languageclient`'s `sendRequest`
  does not expose the JSON-RPC id, so the input-boundary hop joins by sample and
  wall-clock containment rather than by id. The analysis flags those stages
  `time_attributed`. No counter was substituted, because it would look like the
  LSP's own id and would not be one.
- **The extension-host half of `src/vs` is unmarked.** `extHostLanguageRuntime`
  gets no marker, so `execute.renderer_to_supervisor` spans the RPC, the
  `$executeCode` handler, and the session lookup together.
- **The Python kernel emits no trace events.** Only Ark does. Python's side is
  bracketed by the supervisor's send and receive markers, the same way
  Kallichore is, so a Python sample attributes time down to "inside the kernel"
  and no further. The `logger.debug` markers in `positron_ipkernel.py` and
  `variables.py` are log-only and do not join this schema, so every `ark.*` stage
  reads as missing for a Python sample.
- **Services activation is not marked.** The foreground-session change that
  triggers LSP startup is visible only as a log line in `R Supervisor.log`, so
  the cost attributes to the focus chord that triggered it rather than to the
  activation itself.
- **An enqueue is not a send.** Ark's IOPub path has three hops, and only
  `ark.iopub.socket.send` is a transmission. An execute reply is likewise not
  evidence that output is visible.
- **Repeated markers are not summed.** `harness.focus.start` and
  `harness.prompt.assert.start` repeat when `toPass` retries, and
  `renderer.runtime.msg.output` fires per message. The analysis takes the first
  occurrence of each endpoint and flags the stage `ambiguous`.
- **The reduced CI job is not the production lane.** It drops the postgres
  service and the credential steps. Trimming concurrent load can change the
  measurement, so a run that does not reproduce the signal has to be compared
  against the full lane before concluding the signal is absent.

## Side effects

Metric upload is suppressed whenever `POSITRON_PERF_TRACE_DIR` is set
(`test/e2e/utils/metrics/api.ts`), so investigation samples cannot reach the
production dashboard. The timing workflow also never receives `CONNECT_API_KEY`.
