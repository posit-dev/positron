---
name: drive-positron
description: "Launch Positron dev server in an isolated, disposable profile and control the Electron workbench. Use to reproduce UI bugs, verify UI changes, inspect the DOM, take screenshots, interact with the workbench, or attach a debugger without first writing an end-to-end test. Do not use to provide a persistent app instance for a person; use the launch-positron command for that. Only runs when a person invokes it explicitly."
disable-model-invocation: true
---

# Drive Positron through CDP

Use this skill to inspect and interact with a running development build of Positron. Treat the resulting profile and application state as disposable.

This workflow complements automated tests; it does not replace them. Add an appropriate test when the verified behavior needs regression coverage. See `.claude/skills/author-e2e-tests`.

Do not use this workflow to hand a persistent Positron instance to a person:

- the profile is deleted during cleanup;
- native file dialogs are replaced with quick input;
- no watch process recompiles subsequent source edits.

Use the `launch-positron` command for that case.

## Know what this changes in your checkout

The disposable profile is isolated. The build state is not.

Before it starts the application, `scripts/launch.sh` runs `build/lib/preLaunch.ts` against your real checkout. Pre-launch writes to directories that your normal development build also uses:

- `.build/builtInExtensions/<name>`: pre-launch deletes and re-downloads this directory for every built-in extension whose version on disk does not match `product.json`. A rebase that bumps a built-in extension version is enough to trigger it.
- `.build/electron`: pre-launch deletes and re-downloads the whole directory when the installed Electron version does not match the expected one.
- `out/`: pre-launch runs `npm run compile` when this directory is absent. That competes with the build daemons, which own compilation.

An interrupted or failed pre-launch can leave a built-in extension deleted or partially written. Your normal development build then fails to start until you repair it. To repair:

```bash
npm run download-builtin-extensions
npm run electron
```

Do not interrupt the script while it reports that it is running pre-launch.

## Platform support

These scripts run on macOS, Linux, and Windows. On Windows, run them from Git
Bash; they are bash scripts and will not work from PowerShell or `cmd`.

Tools they expect on `PATH`:

| Tool | Used by | Notes |
|---|---|---|
| `node`, `npx` | all | `@playwright/cli` resolves from the repo's `node_modules` |
| `curl` | `launch.sh`, `stop.sh` | CDP readiness and liveness probes |
| `rsync` or `tar` | `launch.sh` | `rsync` preferred; `tar` is the fallback, and is what Git Bash has |
| `jq` | `monaco-paste.sh` | not present in a bare Git Bash; install it separately |
| `cygpath` | `launch.sh` on Windows | ships with Git Bash |

## Launch Positron

Run:

```bash
.claude/skills/drive-positron/scripts/launch.sh -- \
	--use-mock-keychain \
	--disable-workspace-trust \
	--skip-welcome \
	--folder-uri file:///private/tmp/myworkspace
```

Wait for the script to print one JSON object. Record at least:

- `pid`
- `cdpPort`
- `runDir`
- `logFile`

The launcher:

- copies the source profile from `$POSITRON_DEV_USER_DATA_DIR` or `~/.positron-dev`, using `rsync` when present and `tar` otherwise;
- writes only to the disposable copy;
- creates an isolated shared-data directory;
- uses a short run directory under `/tmp` by default;
- assigns unique ports for CDP and the debug endpoints;
- converts the profile paths for the native binary on Windows;
- waits for CDP and verifies that the app remains alive before returning.

### Required launch arguments

| Argument | Purpose |
|---|---|
| `--folder-uri file:///private/tmp/myworkspace` | Open a workspace reliably. Do not pass a bare positional folder: Positron may discard it. On macOS, use the canonical `/private/tmp` path rather than `/tmp`. On Windows the URI needs a drive letter, so build it with `cygpath -m`: `--folder-uri "file:///$(cygpath -m /tmp/myworkspace)"`. |
| `--disable-workspace-trust` | Prevent a modal trust dialog from blocking automation when the seed profile has no trust state. |
| `--use-mock-keychain` | Avoid using the per-user OS keychain from the disposable instance. A `GitHubLoginFailed` message in the log is expected. |
| `--skip-welcome` | Keep the Welcome editor from receiving the initial focus. |

The launcher supplies `--shared-data-dir` automatically, so the disposable instance does not use the normal `~/.positron-shared` store.

## Protect the source profile

The launcher reads the source profile with a one-way `rsync` into the run directory. It does not use `--delete`, and it applies `files.simpleDialog.enable` only to the disposable copy.

It excludes lock files, sockets, singleton state, caches, logs, and workspace storage so the copied profile can run alongside a normal development instance.

To avoid reading the normal development profile at all, create a minimal seed:

```bash
mkdir -p /tmp/positron-seed/User
echo '{"positron.notebook.enabled": true}' \
	> /tmp/positron-seed/User/settings.json
```

Then launch with:

```bash
--source-user-data-dir /tmp/positron-seed
```

## Attach Playwright

Use a literal session name and reuse it for every command:

```bash
npx @playwright/cli -s=positron \
	attach --cdp=http://127.0.0.1:"$CDP_PORT"

npx @playwright/cli -s=positron snapshot
```

Do not derive the session name from `$$`. Separate shell invocations receive different process IDs and would silently create different sessions.

Common operations:

```bash
npx @playwright/cli -s=positron click e153
npx @playwright/cli -s=positron click e980 right
npx @playwright/cli -s=positron type "some text"
npx @playwright/cli -s=positron press Enter
npx @playwright/cli -s=positron resize 1600 1100
npx @playwright/cli -s=positron eval '(() => document.title)()'
npx @playwright/cli -s=positron \
	screenshot --filename="$PWD/shots/01.png"
```

Use element references from the latest snapshot. Do not substitute screen coordinates, and use the positional `right` argument for a right-click.

Filter a large snapshot when looking for a known control:

```bash
R=$(npx @playwright/cli -s=positron snapshot 2>&1 \
	| grep -oE 'button "Run Cell" \[ref=e[0-9]+' \
	| grep -oE 'e[0-9]+$' \
	| head -1)
```

Take a screenshot early when the UI does not match expectations. A screenshot often reveals blocking dialogs, an unopened workspace, missing kernels, or focus in the wrong editor faster than DOM inspection.

### Enter text in Monaco

Do not use `type` or `fill` for notebook cell editors or chat inputs backed by Monaco. Use:

```bash
.claude/skills/drive-positron/scripts/monaco-paste.sh \
	--session positron "text to insert"
```

Use individual `press` operations when testing actual keyboard handling.

## Account for Positron behavior

- Restore focus to the notebook before invoking a notebook action. Opening an output in a plot tab moves focus away from the notebook.
- Ensure the selected Python environment contains the packages the scenario needs. A fresh profile may discover a bare interpreter without packages such as matplotlib or pandas.
- To prioritize Positron's development environment, expose it as the workspace environment:

  ```bash
  ln -s <repo>/extensions/positron-python/.venv \
	/private/tmp/myworkspace/.venv
  ```

- Allow interpreter discovery and marketplace extension installation to finish before concluding that a kernel is unavailable.
- Set `positron.notebook.enabled` to `true` in the workspace or seed profile when testing the Positron notebook editor.
- Expect selectors to change. Prefer the maintained page objects under `test/e2e/pages/` when locating Positron controls; otherwise take a fresh snapshot.

## Use upstream debugging guidance

`scripts/launch.sh` is a maintained fork of
`.agents/skills/launch/scripts/launch.sh`. It does not inherit upstream fixes.

When the upstream script changes:

1. Compare it with this fork.
2. Port applicable fixes without removing the Positron-specific profile, path, isolation, and liveness behavior.
3. Revalidate the launch workflow.

Read `.agents/skills/launch/SKILL.md` when you need:

- the debug-port mapping;
- `dap-cli` breakpoint instructions;
- parallel-instance guidance;
- additional Monaco input details.

## Clean up

Always stop the disposable instance; Positron can retain several gigabytes of memory.

```bash
npx @playwright/cli -s=positron close
.claude/skills/drive-positron/scripts/stop.sh \
	--cdp-port "$CDP_PORT" --run-dir "$RUN_DIR"
```

`stop.sh` signals the process that owns the CDP port, waits for the port to stop answering, forces the stop if it does not, and then removes the run directory. It exits non-zero if the instance is still reachable, so a silent failure to clean up is not possible.

Do not signal the Electron helper processes yourself. Positron reads a terminated renderer as a window crash: it respawns the helpers, shows a "window terminated unexpectedly" dialog, and then ignores the signal sent to the main process, leaving the instance running.

Pass `--run-dir` only when it is the exact `runDir` the launcher reported. The script refuses any path that does not contain a generated `positron-dev-launch` component, and stops the instance without deleting anything when `--run-dir` is omitted.

Do not use `kill "$PID"` on its own. On Windows the reported `pid` belongs to the MSYS shell that exec'd the native Electron binary, so killing it can leave the application running. `stop.sh` locates the real process through the CDP port on every platform.

Remove `.playwright-cli` only if it is the session directory created in the intended workspace.

To confirm independently that no process remains, check that the CDP port no longer answers:

```bash
curl -sf -o /dev/null "http://127.0.0.1:$CDP_PORT/json/version" \
	&& echo "still running" || echo "stopped"
```

This works on every platform. `pgrep -f "remote-debugging-port=$CDP_PORT"` is equivalent on macOS and Linux, but `pgrep` is absent from Git Bash on Windows.

## Troubleshoot failures

- **Attach reports `connect ECONNREFUSED`:** The application exited after opening CDP. Inspect the path reported as `logFile`.
- **The log reports `listen EINVAL` or an IPC path longer than 103 characters:** The run-directory base is too long. Unset `$POSITRON_LAUNCH_TMP` or point it at a shorter directory. This affects macOS and Linux only; Windows uses named pipes and has no such limit.
- **`rsync: command not found` (Windows):** You are on an older copy of `launch.sh`. The current script falls back to `tar` when `rsync` is absent.
- **Snapshot references disappear:** Look for a modal dialog with a screenshot, then take a new snapshot.
- **A built-in extension does not load:** Compile extensions with:

  ```bash
  npm run gulp compile-extensions
  ```

  Do not rely on `watch-extensions` when another extension is already preventing the watch task from starting.
