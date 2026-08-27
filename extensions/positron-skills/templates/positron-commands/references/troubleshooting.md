# Positron session commands

Recovering interpreter sessions (Python, R, or another language) and looking up
help topics. See [SKILL.md]({{skill_dir}}/SKILL.md) for how to call these commands and how
to handle failures. To list the available interpreters or rescan for a newly
installed one, see [interpreters.md]({{skill_dir}}/references/interpreters.md).
For the packages installed in a session, see
[packages.md]({{skill_dir}}/references/packages.md).

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
