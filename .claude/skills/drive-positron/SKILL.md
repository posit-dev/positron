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
- native file dialogs and modal message boxes are replaced with in-app equivalents;
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
| `node`, `npx` | all | the scripts call `node_modules/.bin/playwright-cli` directly and fall back to `npx @playwright/cli` |
| `curl` | `launch.sh`, `stop.sh` | CDP readiness and liveness probes |
| `rsync` or `tar` | `launch.sh` | `rsync` preferred; `tar` is the fallback, and is what Git Bash has |
| `jq` | `monaco-paste.sh`, `quickpick-enum.sh` | not present in a bare Git Bash; install it separately |
| `sqlite3` | `reseed.sh --list-keys` | optional; only used to print the seeded storage keys |
| `cygpath` | `launch.sh` on Windows | ships with Git Bash |
| `tasklist`, `powershell` | `launch.sh` on Windows | liveness check and the WMI launch below |

### Windows launches the app out-of-process on purpose

On Windows `launch.sh` does not spawn the app directly. It writes
`launch-app.cmd` and `launch-app.ps1` into the run directory and has WMI
(`Win32_Process.Create`) start the app, which reparents it to `WmiPrvSE` while
keeping it in the interactive session. Do not "simplify" this back to a direct
background spawn.

The reason is Ark, the R kernel. It statically links a ZeroMQ built with the
`wepoll` poller, which opens `\Device\Afd` directly, and that call fails for any
process inside an agent session's process tree. A directly spawned app therefore
starts, but every R session dies immediately with `exit code 1073741845` and
`not a socket (...epoll.cpp:73)`. Python is unaffected, because its ZeroMQ uses
the `select` poller -- so the symptom looks like an R-specific bug and is not.

macOS and Linux keep the plain background spawn: their ZeroMQ uses kqueue and
kernel epoll, neither of which opens a device handle.

## Launch Positron

Run:

```bash
.claude/skills/drive-positron/scripts/launch.sh -- \
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
- waits for CDP and verifies that the app remains alive before returning;
- keeps the renderer painting while the window is covered by passing Chromium's `--disable-backgrounding-occluded-windows` and `--disable-renderer-backgrounding`. Without them a fully occluded window stops producing frames, so every `click` and element `screenshot` times out on Playwright's stability check while keyboard input and `eval` still work.

### Arguments to pass yourself

Everything before the `--` configures the launcher; everything after it is
handed to the app. Putting a launcher argument after the `--` does not warn:
the app ignores it and the launcher uses its default instead. Misplacing
`--source-user-data-dir` this way copies the real `~/.positron-dev` profile.

| Argument | Purpose |
|---|---|
| `--folder-uri file:///private/tmp/myworkspace` | Open a workspace reliably. Do not pass a bare positional folder: Positron may discard it. On macOS, use the canonical `/private/tmp` path rather than `/tmp`. On Windows the URI needs a drive letter, so build it with `cygpath -m`: `--folder-uri "file:///$(cygpath -m /tmp/myworkspace)"`. |
| `--log debug` | Recommended. At the default level the `[Runtime startup] Phase changed to ...` lines are absent, so runtime startup, discovery, and cache replay cannot be told apart from the log. |

### Arguments the launcher supplies

You do not pass these, and should not need to think about them:

| Argument | Purpose |
|---|---|
| `--disable-workspace-trust` | Prevent a modal trust dialog from blocking automation when the seed profile has no trust state. Without it the app starts in restricted mode with extensions disabled, so interpreter discovery never runs and an empty picker looks like a product bug. |
| `--use-mock-keychain` | Avoid using the per-user OS keychain from the disposable instance. A `GitHubLoginFailed` message in the log is expected. |
| `--skip-welcome` | Keep the Welcome editor from receiving the initial focus. |
| `--shared-data-dir` | Keep the disposable instance off the normal `~/.positron-shared` store. |

Repeating one of the first three after `--` overrides the supplied copy. Pass `--no-default-app-args` before `--` to launch without any of them, which is only useful when the scenario under test is one of the behaviors they suppress, such as the workspace trust prompt itself.

## Protect the source profile

The launcher reads the source profile with a one-way `rsync` into the run directory. It does not use `--delete`, and it applies `files.simpleDialog.enable` and `window.dialogStyle` only to the disposable copy.

It also suppresses, in the disposable copy only, the two prompts a fresh profile raises on startup: the offer to import settings from VS Code (`workbench.settings.importFromVSCode.enabled` set to `false`) and positron-supervisor's offer to let a coding agent found on PATH run code in the window's sessions (marked as already asked in the profile's global state, which needs `sqlite3`). Every run would otherwise dismiss them by hand. Pass `--keep-first-run-prompts` before the `--` when either prompt is what you are testing.

Pyrefly, the extension behind Python hover, completions, outline and diagnostics, stays on, as users have it. Pass `--no-pyrefly` before the `--` to disable it in the disposable copy, through the same `extensions.allowed` entry the e2e tests use, when its startup notices get in the way of a run that does not touch Python editing.

It excludes lock files, sockets, singleton state, caches, logs, and workspace storage so the copied profile can run alongside a normal development instance.

To avoid reading the normal development profile at all, create a minimal seed:

```bash
mkdir -p /tmp/positron-seed/User
echo '{"positron.notebook.enabled": true}' \
	> /tmp/positron-seed/User/settings.json
```

Then launch with it before the `--`, since it is a launcher argument:

```bash
.claude/skills/drive-positron/scripts/launch.sh \
	--source-user-data-dir /tmp/positron-seed -- \
	--folder-uri file:///private/tmp/myworkspace
```

## Launch a second time with the state the first run wrote

A fresh profile only exercises the cold-start path. Anything that depends on
state from a previous run -- the runtime discovery cache, storage-backed
migrations, the recently opened list -- is untested by a single launch, so a bug
that only appears on the second launch cannot be seen at all.

To carry the profile forward, stop the instance and turn its profile into a
seed:

```bash
.claude/skills/drive-positron/scripts/reseed.sh \
	--run-dir "$RUN_DIR" --seed /tmp/positron-warm-seed \
	--cdp-port "$CDP_PORT" --list-keys
```

`reseed.sh` stops the instance without deleting its run directory, copies the
profile database and settings into the seed, and prints the launch command for
the warm run. The instance has to be stopped first: the running app holds
`User/globalStorage/state.vscdb` open and a copy taken mid-write can be torn.

It leaves the run directory in place, so still remove it during cleanup.

## Attach Playwright

Use a literal session name and reuse it for every command:

```bash
./node_modules/.bin/playwright-cli -s=positron \
	attach --cdp=http://127.0.0.1:"$CDP_PORT"

./node_modules/.bin/playwright-cli -s=positron snapshot
```

Do not derive the session name from `$$`. Separate shell invocations receive different process IDs and would silently create different sessions.

Run every command from the repository root, and call the binary directly rather
than through `npx`. It is the same package `npx` resolves to there, but `npx`
re-resolves it every invocation and costs about a second each time. From another
working directory `npx` also installs its own copy, which keeps its sessions
elsewhere and reports the attached session as `The browser 'NAME' is not open`.

Common operations:

```bash
./node_modules/.bin/playwright-cli -s=positron click e153
./node_modules/.bin/playwright-cli -s=positron click e980 right
./node_modules/.bin/playwright-cli -s=positron type "some text"
./node_modules/.bin/playwright-cli -s=positron press Enter
./node_modules/.bin/playwright-cli -s=positron resize 1600 1100
./node_modules/.bin/playwright-cli -s=positron eval '(() => document.title)()'
./node_modules/.bin/playwright-cli -s=positron console warning
./node_modules/.bin/playwright-cli -s=positron \
	screenshot --filename="$PWD/shots/01.png"
```

Use element references from the latest snapshot. Do not substitute screen coordinates, and use the positional `right` argument for a right-click.

`click` also takes a selector. Selectors must be unique, or Playwright's strict
mode fails the step: `button:has-text("Install uv")` also matches a dropdown
reading "Install uv to select a Python version", where `.install-uv-button` does
not.

Snapshot a subtree, not the page: a bare `snapshot` renders the whole workbench,
about 250 lines of YAML, where the ref of the dialog you are in returns a dozen.
Once a flow's container has a ref, keep reusing it.

Filter a large snapshot rather than piping the whole thing through `grep`. To
read the tree around a known control, `find` returns only the matching nodes and
their context:

```bash
./node_modules/.bin/playwright-cli -s=positron find "Run Cell"
```

To capture a reference for a script, query the structured snapshot. Matching
`role` and `name` avoids escaping a regexp over the YAML rendering:

```bash
R=$(./node_modules/.bin/playwright-cli -s=positron --json snapshot \
	| jq -r '.. | objects | select(.role == "button" and .name == "Run Cell") | .ref' \
	| head -1)
```

Take a screenshot early when the UI does not match expectations. Pass `--hires` when the detail being judged is finer than a CSS pixel. A screenshot often reveals blocking dialogs, an unopened workspace, missing kernels, or focus in the wrong editor faster than DOM inspection.

To make a screenshot point at one control rather than leaving the reader to hunt
for it in a full workbench, draw an overlay on the element first. `highlight
--hide` clears every overlay on the page:

```bash
./node_modules/.bin/playwright-cli -s=positron highlight e153
./node_modules/.bin/playwright-cli -s=positron \
	screenshot --hires --filename="$PWD/shots/01.png"
./node_modules/.bin/playwright-cli -s=positron highlight --hide
```

`console` reads the renderer console, which is a separate source from the log
file the launcher reports as `logFile`. It takes a minimum level and defaults to
`info`.

### Enter text in Monaco

Do not use `type` or `fill` for notebook cell editors or chat inputs backed by Monaco. Use:

```bash
.claude/skills/drive-positron/scripts/monaco-paste.sh \
	--session positron "text to insert"
```

Use individual `press` operations when testing actual keyboard handling.

### Log every action

Set `DRIVE_POSITRON_LOG` to a file and every script below appends one line per
action to it, as `<UTC time> <script> -s=<session>: <what>`, so a run's action
log needs no wrapper scripts. Set `DRIVE_POSITRON_SHOTS` to the folder
screenshots go in, and take every one with `shot.sh`, which logs it:

```bash
export DRIVE_POSITRON_LOG="$RUN/actions.log" DRIVE_POSITRON_SHOTS="$RUN/shots"
.claude/skills/drive-positron/scripts/shot.sh --session positron S03-01.png
.claude/skills/drive-positron/scripts/shot.sh --session positron S03-02.png '.positron-variables'
```

Log what the scripts cannot see yourself: a raw `playwright-cli` click or key,
a shell command run outside the app (`lsof`, `sed` on a workspace file), a wait.

### Run a Command Palette command

Typing a title into the palette and pressing Enter runs whatever is
highlighted, and when the command is unavailable, as Notebook: Run All Cells
is while a cell runs, the highlight falls on a "similar commands" entry, which
can delete every cell. Run palette commands with `palette-run.sh`, which runs
only the row whose label is exactly the title, and otherwise runs nothing and
prints what was shown:

```bash
.claude/skills/drive-positron/scripts/palette-run.sh --session positron 'Console: Focus on Console View'
.claude/skills/drive-positron/scripts/palette-run.sh --session positron --dry-run 'Notebook: Run All Cells'
```

The title includes its category, as the palette shows it. It takes focus out
of a webview first, where keyboard shortcuts never reach the workbench. A
command that is "not listed" is a fact about the app's state: record it.

### Open a file

```bash
.claude/skills/drive-positron/scripts/open-file.sh --session positron app.R
.claude/skills/drive-positron/scripts/open-file.sh --session positron rapp/app.R
```

It moves focus out of any webview, opens Quick Open, and picks the row whose
name is exactly the file's (with the folder in its description, when you give
one), then waits for the tab. Cmd+P typed by hand while focus is in the Viewer
or a notebook output goes to the page instead.

### Start a session

```bash
.claude/skills/drive-positron/scripts/start-session.sh --session positron --language r
.claude/skills/drive-positron/scripts/start-session.sh --session positron --language python --name uv
```

It runs Interpreter: Start New Console Session, picks the interpreter whose
row names the language (and `--name`, when several match), and waits until the
new console is ready. It prints the new session's ID. The console's Quick
Launch control is a menu, not a quick pick, and its references change between
snapshots, so do not drive it by hand.

### Run code in a console

With more than one session open, the active console is whichever was used
last, so typing into "the console" sends R code to Python as often as not. Run
code with `console-run.sh` instead of a helper of your own. It makes the named
language's console active, pastes into its input, presses Enter, and checks
that the code was echoed in that console:

```bash
.claude/skills/drive-positron/scripts/console-run.sh --session positron --language r 'x <- 1:10'
printf 'def f(x):\n    return x + 1\n' | .claude/skills/drive-positron/scripts/console-run.sh --session positron --language python
```

It prints one JSON line: the session it used, whether it switched consoles,
whether the session was busy, and whether the code was echoed. It exits 1 when
the code did not land in that console. The code is pasted as written, so `\n`
inside a string stays a backslash and an `n`. It does not start a session; use
`start-session.sh`. A fresh window has usually started one Python session
already, so check the console tabs before starting another. With two sessions
of one language, pass `--name` with part of the session's name as its console
tab shows it. `--no-enter` pastes without running, for checking completions or
an unfinished line. `--capture` waits for the code to finish and returns what
it printed as `output`, so there is no need to write results to a file and read
them back. When the Console view is behind another panel tab, it brings it
forward first.

To read a console without running anything, including one Run App started
(named after the app, such as "Shiny"):

```bash
.claude/skills/drive-positron/scripts/console-read.sh --session positron --language r --tail 20
.claude/skills/drive-positron/scripts/console-read.sh --session positron --name Shiny
```

### Run cells in a notebook

```bash
.claude/skills/drive-positron/scripts/nb.sh --session positron --notebook py.ipynb read
.claude/skills/drive-positron/scripts/nb.sh --session positron --notebook py.ipynb run 2
.claude/skills/drive-positron/scripts/nb.sh --session positron --notebook py.ipynb wait
```

For the Positron notebook editor. `read` prints every cell's number, kind,
execution count, state (running, pending, success, error), first source line
and output text, plus the kernel badge and whether the tab is modified. `run N`
clicks cell N's own Run button; `wait` waits until nothing is running. Each
refuses when the named notebook is not the active editor, so a cell never runs
in the wrong file. Run All goes through `palette-run.sh`.

### Read a Data Explorer grid or a view

```bash
.claude/skills/drive-positron/scripts/de-read.sh --session positron --rows 5
.claude/skills/drive-positron/scripts/view-read.sh --session positron --view Variables
.claude/skills/drive-positron/scripts/view-read.sh --session positron --view Viewer
```

The grid draws only the columns in view; `de-read.sh` scrolls it sideways and
returns every column's name and the top rows' values, plus the status bar, so
there is no need to widen the window. `view-read.sh` prints what a view shows,
leaving out the stacked instances behind it (the Variables pane keeps one per
session); for the Viewer it prints the URL and the page's text from the frames.
A list or tree draws only its visible rows: scroll or filter before saying a row
is missing.

### Run an app

```bash
.claude/skills/drive-positron/scripts/run-app.sh --session positron --list
.claude/skills/drive-positron/scripts/run-app.sh --session positron
```

Clicks the active editor's Run App button, whatever its label ("Run Shiny App",
"Run Flask App in Terminal"), and fails when the editor has none. Then check
`notifications.sh`: a busy session asks first, in a toast.

### Read and answer notifications

A question often arrives as a toast ("The runtime is busy. Do you want to
interrupt it and restart?") that a screenshot misses and the next click hides.
After an action that might ask something, list the toasts before deciding it
did nothing, and answer one by its button:

```bash
.claude/skills/drive-positron/scripts/notifications.sh --session positron
.claude/skills/drive-positron/scripts/notifications.sh --session positron --click No --match 'runtime is busy'
.claude/skills/drive-positron/scripts/notifications.sh --session positron --click "Don't Save"
```

It reads modal dialogs too ("Do you want to save the changes you made to
py.ipynb?"), listed with `"kind": "dialog"` ahead of the toasts. Clear old
toasts with `--clear` once answered, so the next listing shows only new ones.

### Run a command in a terminal

Keys typed into "the terminal" go wherever focus is, and a console often has
it, so a shell command runs as R or Python instead. Run commands with
`terminal-run.sh`. It pastes into the terminal's own input, focuses it, presses
Enter, and checks that focus stayed there:

```bash
.claude/skills/drive-positron/scripts/terminal-run.sh --session positron 'node mcp.mjs list'
.claude/skills/drive-positron/scripts/terminal-run.sh --session positron --index 2 'ls'
```

Open the terminal first (Terminal: Create New Terminal, or Terminal: Create New
Terminal in Editor Area). Only visible terminals count. With more than one
visible, pass `--index`, numbered left to right then top to bottom. It prints
one JSON line and exits 1 when the command did not go to the terminal. Send a
key, such as Ctrl+C to stop a server, with `--key Control+c`. It cannot read the
output, which the terminal draws on a canvas: take a screenshot, or have the
command write a file and read that.

### Keep a run's servers and packages to itself

Several runs often share the machine. Install Python packages only into a venv
of the run's own, a copy of the development venv made in seconds, linked as the
workspace `.venv`; never into `extensions/positron-python/.venv`, which other
runs use at the same time:

```bash
.claude/skills/drive-positron/scripts/run-venv.sh "$RUN/tmp/venv"
ln -s "$RUN/tmp/venv" "$WORKSPACE/.venv"
```

Save the listening ports before launching and compare after cleanup; a new one
is a server left running. Pass `--tree` with your instance's PID (launch.sh
prints it) to see only your own instance's kernels and servers, not other runs':

```bash
.claude/skills/drive-positron/scripts/listeners.sh --save "$RUN/tmp/listeners-before.txt"
.claude/skills/drive-positron/scripts/listeners.sh --tree "$PID" --diff "$RUN/tmp/listeners-before.txt"
```

Port 5000 on a Mac belongs to the AirPlay Receiver (ControlCenter): an app on
it gets a 403 from AirPlay, and a check that the port closed always fails. Run
Flask and the like on another port.

### Read a whole quick pick

Do not count `.monaco-list-row` elements and do not set `scrollTop`. Quick picks
render only a window of rows and move it with a transform, so both report a
short list without failing. Use:

```bash
.claude/skills/drive-positron/scripts/quickpick-enum.sh --session positron
```

It walks the picker with ArrowDown and prints
`index|kind|label|description|detail|active` for every row, headings included,
leaving the picker on the item it started from.

Read `references/reading-ui-state.md` before trusting any other reading of a
list, tree, or quick input widget. It covers the virtualization, the hidden
widgets left behind by closed pickers, and how separators are rendered.

## Account for Positron behavior

- Restore focus to the notebook before invoking a notebook action. Opening an output in a plot tab moves focus away from the notebook.
- Ensure the selected Python environment contains the packages the scenario needs. A fresh profile may discover a bare interpreter without packages such as matplotlib or pandas.
- To prioritize Positron's development environment, expose it as the workspace environment:

  ```bash
  ln -s <repo>/extensions/positron-python/.venv \
	/private/tmp/myworkspace/.venv
  ```

- Allow interpreter discovery and marketplace extension installation to finish before concluding that a kernel is unavailable.
- `positron.notebook.enabled` defaults to `true`, so an `.ipynb` opens in the Positron notebook editor; its toolbar reads "Positron Notebook". Set it to `false` only to test the legacy editor. Reopen Editor With sticks to the file, so a later open of the same file uses the editor chosen last.
- Notebook: Run All Cells is hidden from the palette and toolbar while a cell runs; the toolbar shows Stop Execution in its place.
- Notebook cells are `[role=article]`, not `<article>` elements.
- Keyboard shortcuts do nothing while focus is inside a webview (the Viewer, an HTML output, a Shiny app). `palette-run.sh` moves focus out first; for a raw key press, click the editor or a pane first.
- The Viewer's content is in nested iframes that snapshots reach (refs like `f4e3`), but their refs change after every reload or app restart; take a fresh snapshot each time.
- After Developer: Reload Window, snapshot refs restart with a frame prefix (`f1e12`), so a helper that greps `ref=e` finds nothing. Take a fresh snapshot, and if a command still fails, `attach` the session again. A frame that failed to load shows only as `iframe`, the same as one still loading.
- A terminal created while hidden, or a window resized through CDP, can draw its text at the wrong size. Before reporting a display problem in a terminal, compare a terminal opened by hand at the same window size.
- Modal message boxes are clickable because the launcher forces `window.dialogStyle: "custom"`. Without it Electron draws a native dialog that CDP can neither see nor dismiss, and the blocked renderer looks like a hung app. Judge such a dialog's wording from this path but not its appearance; a real user sees the native one.
- Two things are called a modal. `.positron-modal-dialog-box`, which the `Modals` page object matches, is Positron's own React modal such as the New Folder flow. A `showInformationMessage(..., { modal: true })` raised from inside it is the upstream `.monaco-dialog-box`, which that page object will not find.
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
./node_modules/.bin/playwright-cli -s=positron close
.claude/skills/drive-positron/scripts/stop.sh \
	--cdp-port "$CDP_PORT" --run-dir "$RUN_DIR"
```

Run `stop.sh` in its own command, after you have confirmed that every
screenshot or file you need exists. A command that fails earlier in the same
chain, such as an element screenshot that times out, cannot be retried once the
instance is gone.

`stop.sh` signals the process that owns the CDP port, waits for the port to stop answering, forces the stop if it does not, and then removes the run directory. It exits non-zero if the instance is still reachable, so a silent failure to clean up is not possible.

`launch.sh` and `stop.sh` each add a timestamped line to `instances.log` beside the run directories (`/tmp/positron-dev-launch/` by default), so you can see how many instances were running at once.

Do not signal the Electron helper processes yourself. Positron reads a terminated renderer as a window crash: it respawns the helpers, shows a "window terminated unexpectedly" dialog, and then ignores the signal sent to the main process, leaving the instance running.

Pass `--run-dir` only when it is the exact `runDir` the launcher reported. The script refuses any path that does not contain a generated `positron-dev-launch` component, and stops the instance without deleting anything when `--run-dir` is omitted.

Do not use `kill "$PID"` on its own. On Windows the reported `pid` belongs to the MSYS shell that exec'd the native Electron binary, so killing it can leave the application running. `stop.sh` locates the real process through the CDP port on every platform.

Never remove `.playwright-cli`. It holds the snapshot files of every run that calls `playwright-cli` from that folder, and other runs on the machine share it; sessions themselves are not stored there, so removing it frees nothing.

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
- **A command reports an error:** The CLI exits non-zero on a failed command, so check the exit status rather than matching on its output.
- **Snapshot references disappear:** Look for a modal dialog with a screenshot, then take a new snapshot.
- **A built-in extension does not load:** Compile extensions with:

  ```bash
  npm run gulp compile-extensions
  ```

  Do not rely on `watch-extensions` when another extension is already preventing the watch task from starting.
