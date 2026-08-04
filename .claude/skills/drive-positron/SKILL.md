---
name: drive-positron
description: "Launch Positron dev server in an isolated, disposable profile and control the Electron workbench. Use to reproduce UI bugs, verify UI changes, inspect the DOM, take screenshots, interact with the workbench, or attach a debugger without first writing an end-to-end test. Do not use to provide a persistent app instance for a person; use the launch-positron command for that."
---

# Drive Positron through CDP

Use this skill to inspect and interact with a running development build of Positron. Treat the resulting profile and application state as disposable.

This workflow complements automated tests; it does not replace them. Add an appropriate test when the verified behavior needs regression coverage. See `.claude/skills/author-e2e-tests`.

Do not use this workflow to hand a persistent Positron instance to a person:

- the profile is deleted during cleanup;
- native file dialogs are replaced with quick input;
- no watch process recompiles subsequent source edits.

Use the `launch-positron` command for that case.

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

- copies the source profile from `$POSITRON_DEV_USER_DATA_DIR` or `~/.positron-dev`;
- writes only to the disposable copy;
- creates an isolated shared-data directory;
- uses a short run directory under `/tmp` by default;
- assigns unique ports for CDP and the debug endpoints;
- waits for CDP and verifies that the app remains alive before returning.

### Required launch arguments

| Argument | Purpose |
|---|---|
| `--folder-uri file:///private/tmp/myworkspace` | Open a workspace reliably. Do not pass a bare positional folder: Positron may discard it. On macOS, use the canonical `/private/tmp` path rather than `/tmp`. |
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
kill "$PID"
```

Before deleting anything, verify that `RUN_DIR` is the exact `runDir` reported by the launcher and points to a generated `positron-dev-launch` directory:

```bash
case "${RUN_DIR:-}" in
	*/positron-dev-launch/*)
		rm -rf -- "${RUN_DIR:?}"
		;;
	*)
		echo "Refusing to remove unexpected run directory: ${RUN_DIR:-<empty>}" >&2
		exit 1
		;;
esac
```

Remove `.playwright-cli` only if it is the session directory created in the intended workspace.

Confirm that no process remains:

```bash
pgrep -f "remote-debugging-port=$CDP_PORT"
```

An empty result means cleanup succeeded.

## Troubleshoot failures

- **Attach reports `connect ECONNREFUSED`:** The application exited after opening CDP. Inspect the path reported as `logFile`.
- **The log reports `listen EINVAL` or an IPC path longer than 103 characters:** The run-directory base is too long. Unset `$POSITRON_LAUNCH_TMP` or point it at a shorter directory.
- **Snapshot references disappear:** Look for a modal dialog with a screenshot, then take a new snapshot.
- **A built-in extension does not load:** Compile extensions with:

  ```bash
  npm run gulp compile-extensions
  ```

  Do not rely on `watch-extensions` when another extension is already preventing the watch task from starting.
