# Positron interpreter, session and package commands

Diagnosing and recovering R and Python interpreter sessions, managing packages,
and looking up help topics. See [SKILL.md](../SKILL.md) for how to call these
commands and how to handle failures.

The **Arguments** and **Returns** entries below are generated from the running
build's command metadata, so they always match this Positron. The surrounding
guidance is hand-written.

## Diagnosing why an interpreter isn't showing up

### `workbench.action.language.runtime.discoverAllRuntimes`

Rediscovers all installed interpreters so newly installed environments become
available. Positron only scans for interpreters at certain points, so a
freshly installed R or Python environment may not appear until a rescan is
forced. No precondition -- always enabled.

{{command:workbench.action.language.runtime.discoverAllRuntimes}}

### `positron.startupDiagnostics.show`

Opens the runtime startup diagnostics editor to inspect interpreter
discovery output. Use this when a rescan alone doesn't surface the missing
interpreter, or when you need to show the user *why* discovery failed rather
than just retrying blindly -- it displays the actual discovery log. No
precondition -- always enabled.

{{command:positron.startupDiagnostics.show}}

**Worked flow -- "my R/Python interpreter isn't showing up":**

1. Call `workbench.action.language.runtime.discoverAllRuntimes` to force a
   fresh scan.
2. If the interpreter now appears (e.g., in the interpreter picker), you're
   done.
3. If it still doesn't appear, call `positron.startupDiagnostics.show` to
   open the startup diagnostics editor, and report what it shows rather than
   guessing at the cause.

Do not reach for `workbench.action.language.runtime.restartActiveSession` as
part of this flow -- restarting is for recovering a session that's already
running, not for interpreter discovery, and (as noted below) it discards
session state.

## Controlling the active interpreter session

### `workbench.action.languageRuntime.interrupt`

Interrupts the active interpreter runtime session -- e.g., stops a running
computation. Non-destructive: session state (variables, loaded packages) is
preserved. Try this first when code appears stuck (an infinite loop, a
long-running call the user wants to cancel). No precondition -- always enabled.

{{command:workbench.action.languageRuntime.interrupt}}

### `workbench.action.language.runtime.restartActiveSession`

Restarts the active interpreter runtime session. **This discards all session
state** -- variables, loaded packages, and command history in that session are
lost. Always tell the user this will happen before calling it, and prefer
`interrupt` first when the goal is just to stop something running rather than
to get a clean session. No precondition -- always enabled.

{{command:workbench.action.language.runtime.restartActiveSession}}

## Managing packages

### `positronPackages.refreshPackages`

Refreshes the list of installed packages in the active runtime session. Use
when a package was installed or removed outside of Positron (e.g., from a
terminal) and the Packages pane looks stale.

Precondition: the Packages pane must be enabled by configuration, and a
package operation must currently be able to run (in practice, this generally
requires an active runtime session).

{{command:positronPackages.refreshPackages}}

### `positronPackages.updateAllPackages`

Updates every installed package in the active runtime session to its latest
available version. Use when the user asks to update all their packages.
Updating can take a while for large environments -- say so. If code that's
already running in the session doesn't reflect an update afterward, a session
restart may be needed for it to take effect; mention that possibility and, if
the user wants to proceed, use `workbench.action.language.runtime.restartActiveSession`
with the state-loss warning above.

Precondition: same as `refreshPackages` -- Packages pane enabled and a package
operation currently able to run.

{{command:positronPackages.updateAllPackages}}

## Looking up help topics

### `positron.help.lookupHelpTopic`

Shows help for a topic -- typically a function or symbol name -- in the Help
pane. Uses the language of the active editor, or of the foreground interpreter
session if no editor is open. Requires a running interpreter session for that
language to actually resolve the topic.

Pass the topic exactly as the user names it (a bare function/symbol, e.g.
`mean`, not a sentence). If the user hasn't specified a topic, ask before
calling. The command itself is always enabled, but expect a `found: false`
result (not `disabled`) if there's no running session for the relevant
language; relay the returned `message` rather than re-guessing the reason. To
bring the Help pane into view after a lookup, use
`workbench.panel.positronHelp.focus` from [ui.md](ui.md).

{{command:positron.help.lookupHelpTopic}}
