---
name: drive-positron
description: "Launch Positron from sources into a throwaway profile and drive it interactively with @playwright/cli over CDP - click, type, screenshot, inspect the DOM, set breakpoints. Use to verify a UI change in the real app without writing an e2e test, to reproduce a UI bug, or to check behavior an assertion can't judge. To hand a human a Positron they can work in, use the launch-positron command instead - this profile is a throwaway and has no watch daemon."
---

# Launch Positron for UI automation

Verify a change in the running app, interactively, with nothing committed. Each
command is a separate invocation, so you can look, adjust, and look again -
unlike an e2e test, where a wrong assertion costs a full re-run.

**This is not a substitute for e2e tests.** Use it to check a change works and to
explore behavior. If the behavior should stay working, it still needs a test -
see `.claude/skills/author-e2e-tests`.

**Not for handing to a human.** `launch.sh --full` does open a usable window, but
the profile is a throwaway (state doesn't persist, teardown deletes it), file
dialogs are forced to the quick-input picker, and there's no watch daemon so
edits made after launch aren't recompiled. Use the `launch-positron` command for
that.

## Relationship to the upstream skill

`scripts/launch.sh` here is a **hard fork** of
`.agents/skills/launch/scripts/launch.sh`, which is upstream VS Code's file
(arrived via `Merge upstream 1.124.0`, `2affe251800`). We maintain ours
independently and do **not** inherit upstream fixes. When upstream's version
changes, diff it against ours and port anything worth having.

Read the upstream `SKILL.md` for the parts we didn't duplicate: the debug-port
table, `dap-cli` breakpoint workflow, parallel multi-instance pattern, and the
`monaco-paste.sh` details. Everything below is what differs for Positron or what
we learned the hard way.

## Launch

```bash
.claude/skills/drive-positron/scripts/launch.sh -- \
	--use-mock-keychain --disable-workspace-trust --skip-welcome \
	--folder-uri file:///private/tmp/myworkspace
```

Blocks until CDP is up, then prints one JSON line with the ports and paths. Grab
`cdpPort` from it.

Defaults that differ from upstream: the source profile is `~/.positron-dev`
(override with `--source-user-data-dir` or `$POSITRON_DEV_USER_DATA_DIR`), and
`RUN_DIR` is under `/tmp` rather than `$TMPDIR`.

### The flags, and why each is needed

| Flag | Why |
|---|---|
| `--folder-uri file:///private/tmp/x` | **A bare positional folder path is silently dropped** - the window opens with no workspace. Use the real path; `/tmp` is a symlink to `/private/tmp` on macOS. |
| `--disable-workspace-trust` | Otherwise a modal trust dialog blocks everything and the window sits in Restricted Mode. Only bites with a seed profile that has no trust store. |
| `--use-mock-keychain` | The OS keychain is per-user and **not** isolated by `--user-data-dir`. Expect a harmless `GitHubLoginFailed` in the log. |
| `--skip-welcome` | Otherwise the Welcome tab is the active editor. |

`--shared-data-dir` is passed automatically and Positron honors it (declared in
`argv.ts`, consumed in `environmentService.ts`), so the fixed-path shared store
at `~/.positron-shared` is safe from a throwaway instance.

### Does this touch my real profile?

No. The source profile is only ever read: `rsync -a "$SOURCE_UDD/" "$DEST_UDD/"`,
one-directional, no `--delete`. The `files.simpleDialog.enable` override is
written to the temp copy. `Singleton*`, `*.lock`, and `*.sock` are excluded so
the copy can't conflict with a live instance - safe to run alongside your normal
dev Positron.

If you want belt-and-braces, seed from a scratch dir instead. Anything you need
in user settings goes here:

```bash
mkdir -p /tmp/positron-seed/User
echo '{"positron.notebook.enabled": true}' > /tmp/positron-seed/User/settings.json
# then: --source-user-data-dir /tmp/positron-seed
```

## Drive it

```bash
npx @playwright/cli -s=positron attach --cdp=http://127.0.0.1:$CDP
npx @playwright/cli -s=positron snapshot
```

**Always pass the same `-s=<name>` on every call**, and use a literal name -
**not `$$`**. Each Bash tool call is a separate shell, so `$$` changes between
calls and you silently end up in a different session.

```bash
npx @playwright/cli -s=positron click e153            # ref from snapshot, NOT coordinates
npx @playwright/cli -s=positron click e980 right      # right-click; NOT --button=right
npx @playwright/cli -s=positron type "some text"      # works in quick input
npx @playwright/cli -s=positron press Enter
npx @playwright/cli -s=positron resize 1600 1100      # does not survive a relaunch
npx @playwright/cli -s=positron eval '(() => document.title)()'
npx @playwright/cli -s=positron screenshot --filename="$PWD/shots/01.png"
```

Grab a ref by filtering the snapshot rather than reading all of it:

```bash
R=$(npx @playwright/cli -s=positron snapshot 2>&1 \
	| grep -oE 'button "Run Cell" \[ref=e[0-9]+' | grep -oE 'e[0-9]+$' | head -1)
```

**Screenshot early and often.** When something doesn't work, a screenshot tells
you why in one step - a modal dialog, an empty workspace, a missing kernel -
where DOM probing takes many and can still miss it. Read the PNG directly.

**Monaco (cell editors, chat input) ignores `type` and `fill`.** Use
`scripts/monaco-paste.sh`, or per-key `press`.

## Positron-specific traps

- **Notebook actions need the notebook to be the active editor.** After popping
  an output into a plot tab, that tab has focus, so the next notebook action
  silently does nothing. Click the notebook tab first.
- **A fresh profile auto-picks whatever Python it finds** - often a bare uv
  interpreter with no matplotlib/pandas. Symlink a real venv into the workspace
  root so discovery prefers it:
  `ln -s <repo>/extensions/positron-python/.venv /tmp/myworkspace/.venv`
- **Interpreter discovery and marketplace installs run on every launch**, so a
  fresh profile takes a while before a kernel is ready. Wait, don't assume.
- **Positron notebooks need `positron.notebook.enabled: true`** in workspace or
  seed-profile settings, or you get the VS Code notebook editor instead.
- **Selectors go stale.** Prefer `test/e2e/pages/*.ts` (e.g.
  `notebooksPositron.ts`) as the source of truth - those Page Object Models are
  maintained against the app. Otherwise snapshot and read the current DOM.

## Clean up

Positron eats 1-4 GB. Always tear down:

```bash
npx @playwright/cli -s=positron close
kill "$PID"
rm -rf "$RUN_DIR" .playwright-cli
```

Verify with `pgrep -f "remote-debugging-port=$CDP"` - `ps aux | grep` also
matches your own shell wrappers and will look like leftovers when there are none.

## Troubleshooting

- **`connect ECONNREFUSED` on attach** - the app died after CDP opened. Read
  `logFile` from the launch JSON.
- **`listen EINVAL` / "IPC handle ... longer than 103 chars"** - the run dir is
  too long. This is what the `/tmp` default exists to prevent; check
  `$POSITRON_LAUNCH_TMP` isn't set to something long.
- **Refs suddenly missing from snapshot** - usually a modal has taken over.
  Screenshot.
- **Built-in extension fails to load** - extensions aren't compiled. Run
  `npm run gulp compile-extensions` (`watch-extensions` dies if any single
  extension fails).
