# Positron session and package commands

Recovering interpreter sessions (Python, R, or another language), managing
packages, and looking up help topics. See [SKILL.md]({{skill_dir}}/SKILL.md) for how to call these commands and how
to handle failures. To list the available interpreters or rescan for a newly
installed one, see [interpreters.md]({{skill_dir}}/references/interpreters.md).

The **Arguments** and **Returns** entries below are generated from the running
build's command metadata, so they always match this Positron. The surrounding
guidance is hand-written.

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
`workbench.panel.positronHelp.focus` from [ui.md]({{skill_dir}}/references/ui.md).

{{command:positron.help.lookupHelpTopic}}
