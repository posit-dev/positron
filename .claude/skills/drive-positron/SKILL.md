---
name: drive-positron
description: "Launch Positron dev server in an isolated, disposable profile and control the Electron workbench. Use to reproduce UI bugs, verify UI changes, inspect the DOM, take screenshots, interact with the workbench, or attach a debugger without first writing an end-to-end test. Do not use to provide a persistent app instance for a person; use the launch-positron command for that. Only runs when a person invokes it explicitly."
disable-model-invocation: true
---

# Drive Positron through CDP

Use this skill to inspect and interact with a running development build of
Positron. Treat the resulting profile and application state as disposable.

This workflow complements automated tests; it does not replace them. Add a test
when the verified behavior needs regression coverage
(`.claude/skills/author-e2e-tests`).

Do not use it to hand a persistent Positron to a person: the profile is deleted
at cleanup, native dialogs are replaced with in-app ones, and nothing
recompiles later source edits. Use the `launch-positron` command for that.

This file is a guide to choosing and combining the helpers in `scripts/`. Each
helper's header comment is the reference for its flags, output and exit codes:
`bash .claude/skills/drive-positron/scripts/X.sh --help` prints it. To change a
helper or add one, read [CONTRIBUTING.md](CONTRIBUTING.md).

## Know what this changes in your checkout

The disposable profile is isolated. The build state is not.

Before it starts the application, `launch.sh` runs `build/lib/preLaunch.ts`
against your real checkout, which writes to directories your normal development
build also uses:

- `.build/builtInExtensions/<name>`: deleted and re-downloaded for every
  built-in extension whose version on disk does not match `product.json`. A
  rebase that bumps one is enough.
- `.build/electron`: deleted and re-downloaded when the Electron version does
  not match.
- `out/`: when it is absent, pre-launch runs `npm run compile`, which competes
  with the build daemons.

An interrupted pre-launch can leave a built-in extension deleted or half
written, and your normal build then fails to start. Do not interrupt the script
while it reports pre-launch. To repair:

```bash
npm run download-builtin-extensions
npm run electron
```

## Platforms

macOS, Linux, and Windows from Git Bash (not PowerShell or `cmd`). The helpers
need `node` and `curl`, `rsync` or `tar`, and `jq` (absent from a bare Git
Bash); a header lists any other tool its script needs. On Windows, `launch.sh`
starts the app through WMI on purpose; the comment above that code says why.

## Launch, attach, clean up

Launch, from the repository root:

```bash
.claude/skills/drive-positron/scripts/launch.sh -- \
	--folder-uri file:///private/tmp/myworkspace --log debug
```

It prints one JSON line; keep `pid`, `cdpPort`, `runDir` and `logFile`.
Launcher flags go before the `--` and app arguments after it; a launcher flag
put after it is silently ignored. The header lists both, and the app arguments
the launcher supplies. Do not opt out of those unless the scenario is what they
suppress.

The profile is a copy of `$POSITRON_DEV_USER_DATA_DIR` or `~/.positron-dev`,
or of `--source-user-data-dir`. To avoid reading your own profile, make a
minimal seed (`mkdir -p /tmp/seed/User` and a `settings.json` in it) and pass
that. A fresh profile tests only the cold start; for a second launch with the
state the first one wrote (discovery cache, migrations, recent files),
`reseed.sh` stops the instance and turns its profile into a seed.

To relaunch the same instance on its own profile (workspace storage, open
editors, installed extensions and all):

```bash
.claude/skills/drive-positron/scripts/palette-run.sh --session positron 'Close Window'  # saves the window's state
./node_modules/.bin/playwright-cli -s=positron close
.claude/skills/drive-positron/scripts/stop.sh --cdp-port "$CDP_PORT"                     # no --run-dir: keep it
.claude/skills/drive-positron/scripts/launch.sh --reuse-profile "$RUN_DIR" -- --folder-uri file:///private/tmp/ws
```

macOS has no Quit in the palette, and Cmd+Q cannot be sent through CDP:
Close Window, then `stop.sh`. Stop both runs with `--run-dir` at the end.

Attach Playwright under a literal session name, and use that name in every
command and helper (`--session positron`):

```bash
./node_modules/.bin/playwright-cli -s=positron attach --cdp=http://127.0.0.1:"$CDP_PORT"
```

- Do not derive the name from `$$`: each shell call has its own PID, so each
  would get its own session.
- Run from the repository root and call the binary directly. `npx` costs about a
  second per call, and from another folder installs its own copy, which reports
  `The browser 'NAME' is not open`.
- Reload the window, open another folder in it, or open a new window with
  `window.sh` (`reload`, `open-folder PATH`, `new-window`): it waits for the
  workbench to come back and attaches the session again if it lost the page.
  Take a fresh snapshot after: refs restart with a frame prefix (`f1e12`).

Log every action. With these set, every helper appends one line per action to
the log, with the key values it returned after "->" (the plot shown, the
cursor, the cell's output), every read helper one line with the values it read
("read ..."), every failed call one line with its error ("FAILED ..."), so a
negative check has its evidence too, and `shot.sh` saves into the folder and
logs the shot:

```bash
export DRIVE_POSITRON_LOG="$RUN/actions.log" DRIVE_POSITRON_SHOTS="$RUN/shots"
```

Log yourself what the helpers cannot see: a raw `playwright-cli` click or key, a
shell command outside the app, a wait.

Clean up. Positron can hold several gigabytes, so always stop the instance:

```bash
./node_modules/.bin/playwright-cli -s=positron close
.claude/skills/drive-positron/scripts/stop.sh --cdp-port "$CDP_PORT" --run-dir "$RUN_DIR"
```

- Before `stop.sh`, and before closing a window: copy any logs you need from
  `runDir` (the instance's logs are in `<runDir>/logs`), and read the browser
  console (`playwright-cli console`), which exists only in a live window;
  confirm every screenshot exists, and run
  `listeners.sh --diff`, which needs the instance running to know its process
  tree.
- Run `stop.sh` in a command of its own: a failure earlier in the same chain
  cannot be retried once the instance is gone.
- Never `kill "$PID"` (on Windows it is the MSYS shell, not the app), and never
  remove `.playwright-cli`, which other runs share.

## Principles

- **Never press Escape while a `.qmd` is in front.** With its kernel busy,
  Escape is Quarto: Interrupt Kernel wherever focus is: in the editor, on the
  workbench, over a completion list or a hover. Only a quick input and a menu
  that has focus take the key first. The helpers close things without it
  (`editor.sh suggest` and `hover` close their widget by moving focus); a raw
  `press Escape` in a `.qmd` can stop the cell under test.

- **Locate by role and name.** Find controls by the accessible role and name a
  screen reader announces, not CSS classes or coordinates. `ui.sh read VIEW`
  shows them; copy the name from there.
- **Fail loud.** Every helper exits non-zero with `ok: false` and an `error`
  when it could not do what was asked, and refuses rather than guessing: a
  command not in the palette, focus not where the keys would go, a file that is
  not the active editor. Check the exit status. A refusal is often a fact
  about the app worth recording. An argument a helper does not take is a
  usage error (exit 2), logged like any failure. When a modal dialog is open,
  the error of any failing helper names it and its buttons ("dialogs"): it is
  usually why keys and clicks went nowhere.
- **Never type into the Command Palette or Quick Open and press Enter.** When
  no row matches exactly, the highlighted row can be a different command.
  `palette-run.sh`, `open-file.sh` and `ui.sh pick` run a row only when its
  label matches exactly.
- **One call per command.** Each helper is one Playwright call (about a
  second). Batch independent steps into one Bash call, and use a helper before
  a string of raw `playwright-cli` commands.
- **Read before you act.** Read the view, then act on what it shows; actions
  report what changed, so read the answer before the next step. Take a
  screenshot early when the UI does not match expectations: it shows a blocking
  dialog, an unopened workspace, or focus in the wrong place faster than DOM
  reads.

## To do X, use Y

All in `.claude/skills/drive-positron/scripts/`.

| To | Use |
|---|---|
| Launch a disposable instance | `launch.sh` |
| Stop it and remove its run directory | `stop.sh` |
| Launch again warm, from the last run's profile | `reseed.sh` |
| Give a run its own Python venv to install into | `run-venv.sh` |
| Find servers a run left listening | `listeners.sh --save`, then `--diff` |
| Run a Command Palette command, or check one is listed | `palette-run.sh` (`--dry-run`) |
| Open a workspace file | `open-file.sh` |
| Start an R or Python console | `start-session.sh` |
| List the open sessions (`--all`: notebook and Quarto ones too) | `panel.sh sessions` |
| Make a console the active one, without running code | `panel.sh console` |
| Run code in a console, and get its output | `console-run.sh` (`--capture`) |
| Read a console, or the prompt it shows | `console-read.sh` (`--prompt`) |
| Read, move in, type into, save or run a text editor | `editor.sh` |
| Completions, the hover, Go to Definition at a place in a file | `editor.sh suggest`, `hover`, `definition` (`--at L:C`) |
| Reload the window, open another folder, open a new window | `window.sh` |
| Catch a state that lasts a second (a banner, a status) | `ui.sh watch VIEW` in the background, then act |
| Breakpoints, stepping, call stack, watches, Debug Console | `debug.sh` |
| Run Quarto cells and read their inline output | `qmd.sh` |
| Read and drive the Plots pane, or a plot in an editor | `plots.sh` |
| Read, run, type into and manage Positron notebook cells | `nb.sh` (`type N TEXT`) |
| Read a Data Explorer grid | `de-read.sh` |
| Print a view's accessibility tree (Variables, Viewer page) | `view-read.sh` |
| Read, click, fill, check or choose in any view or dialog | `ui.sh` |
| The Viewer's toolbar, and the page in it | `viewer.sh` |
| Rows of a tree view, expand, context menus | `tree.sh` |
| Panel tabs, terminals, sessions, editor tabs, pane sizes | `panel.sh` |
| Toasts and modal dialogs, and their buttons | `notifications.sh` |
| Run a shell command in a terminal, send a key, read it | `terminal-run.sh` |
| Click an editor's Run App button | `run-app.sh` |
| Take and log a screenshot, of any app window | `shot.sh` (`--list`, `--window N`, `--view 'active console'`) |
| Set a user or workspace setting, merged into its settings.json | `settings.sh` |
| Read the clipboard's text, or save its image (macOS) | `clipboard.sh` |
| Read every row of an open quick pick | `quickpick-enum.sh` |
| Put text into a Monaco chat input | `monaco-paste.sh` |

`ui.sh` works in any view, but where the accessibility tree is thin, use the
area's own helper: the Variables pane and the Data Explorer grid read as one
line of text, and Quarto inline output is not in the tree at all.

## Raw playwright-cli, when no helper fits

```bash
./node_modules/.bin/playwright-cli -s=positron snapshot          # ~250 lines; snapshot a container's ref instead
./node_modules/.bin/playwright-cli -s=positron find "Run Cell"   # matching nodes and their context
./node_modules/.bin/playwright-cli -s=positron click e153        # `click e980 right` for a right-click
./node_modules/.bin/playwright-cli -s=positron press ArrowDown   # Playwright key names, exact case
./node_modules/.bin/playwright-cli -s=positron highlight e153    # overlay before a shot; --hide clears
./node_modules/.bin/playwright-cli -s=positron console warning   # the renderer console, not logFile
```

- The agent shell is often zsh, which does not split a variable into words:
  `PW="playwright-cli -s=x"` then `$PW click ...` runs as one word and fails.
  Write the command out, or use a function or an array.
- Use refs from the latest snapshot, never screen coordinates. A selector must
  match one element, or strict mode fails the step.
- An unknown key name (`BackSpace`) is rejected and nothing is pressed.
- Do not `type` or `fill` into Monaco: `editor.sh` for files, `monaco-paste.sh`
  for chat inputs (it replaces the whole text).
- To capture a ref in a script, query `--json snapshot` with `jq` on `.role` and
  `.name` rather than grepping the YAML.
- A screenshot is taken with `shot.sh`, which logs it; pass `--hires` to a raw
  `screenshot` only for detail finer than a CSS pixel.

## What the harness changes

A finding that depends on one of these is about the harness, not the product:

- Modal message boxes are in-app (`window.dialogStyle: "custom"`), so CDP can
  click them. A real user sees the native dialog: judge its wording here, not
  its look.
- The app runs with umask 077, so files it saves are mode 600.
- Workspace trust is off, the keychain is mocked, Welcome is skipped, and the
  first-run prompts are suppressed (see the `launch.sh` header).
- A terminal created while hidden, or a window resized through CDP, can draw
  text at the wrong size. Compare with a terminal opened by hand at the same
  size before reporting it.

## Positron behavior to account for

- Keyboard shortcuts do nothing while focus is in a webview (the Viewer, an HTML
  output, an app). The helpers move focus out first; before a raw key press,
  click the editor or a pane.
- With several sessions, the active console is the one used last; code typed
  into "the console" lands in the wrong one. `console-run.sh` names the
  language. Keys typed into "the terminal" go wherever focus is;
  `terminal-run.sh` checks.
- In a `.qmd` with a cell running, Escape is Quarto: Interrupt Kernel, wherever
  focus is (see Principles). Do not press it to close something.
- In a notebook in command mode, typed keys edit cells (`3` makes a cell
  Markdown). Restore focus to the notebook before a notebook action: opening an
  output in a plot tab moves it away.
- `positron.notebook.enabled` defaults to `true`, so an `.ipynb` opens in the
  Positron notebook editor. Reopen Editor With sticks to the file. Notebook
  cells are `[role=article]`, not `<article>`.
- Notebook: Run All Cells is hidden while a cell runs; the toolbar shows Stop
  Execution in its place.
- A fresh window starts sessions by itself: Python when the workspace has a
  venv, R when it has `.R` files, some seconds after launch. `panel.sh
  sessions` lists what is open; `start-session.sh` reports an open session of
  the language rather than starting a second (`--new` starts one anyway).
- A fresh profile may find a bare interpreter without matplotlib or pandas. Give
  the run a venv (`run-venv.sh`, linked as the workspace `.venv`), and let
  interpreter discovery and extension installs finish before deciding a kernel
  is missing.
- Lists, trees and quick picks draw only the rows in view, moved with a
  transform, and closed pickers stay in the DOM. Scroll or filter before saying
  a row is missing, and read `references/reading-ui-state.md` before trusting
  any other reading of one.
- The Viewer's frames get new refs after every reload or app restart; a frame
  that failed to load shows only as `iframe`, the same as one still loading.
- Two things are called a modal: Positron's React `.positron-modal-dialog-box`
  (what the e2e `Modals` page object matches) and the upstream
  `.monaco-dialog-box`, which a `showInformationMessage(..., { modal: true })`
  raises even from inside the first.
- Expect selectors to change. The helpers keep theirs in
  `scripts/selectors.ts`; the page objects under `test/e2e/pages/` are
  maintained too; otherwise take a fresh snapshot.

## Troubleshoot

- **Attach reports `connect ECONNREFUSED`:** the app exited after opening CDP.
  Read `logFile`.
- **`listen EINVAL`, or an IPC path over 103 characters (macOS, Linux):** the
  run-directory base is too long. Unset `$POSITRON_LAUNCH_TMP` or shorten it.
- **Snapshot refs disappear:** look for a modal dialog in a screenshot, then
  snapshot again. After a reload, attach again.
- **Keys stop working in every editor** (`editor.sh key` fails with "the key
  changed nothing"; cursor, text and unsaved state stay as they were):
  `window.sh reload` clears it.
- **A built-in extension does not load:** `npm run gulp compile-extensions`. Do
  not rely on `watch-extensions` when another extension stops the watch task.
- **Confirm an instance is gone:** `curl -sf -o /dev/null
  "http://127.0.0.1:$CDP_PORT/json/version" && echo running || echo stopped`
  works on every platform.

`launch.sh` is a fork of `.agents/skills/launch/scripts/launch.sh` and does not
inherit its fixes; when the upstream changes, port what applies and keep the
Positron profile, path, isolation and liveness behavior. Read
`.agents/skills/launch/SKILL.md` for the debug-port mapping, `dap-cli`
breakpoints and parallel instances.
