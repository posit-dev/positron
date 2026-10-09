# Positron session recovery commands

Recovering a stuck interpreter session (Python, R, or another language) and
showing or reading help topics. See [SKILL.md]({{skill_dir}}/SKILL.md) for how to call
these commands and how to handle failures. To list the running sessions, switch
between them, or start a new one, see
[sessions.md]({{skill_dir}}/references/sessions.md). To list the available
interpreters or rescan for a newly installed one, see
[interpreters.md]({{skill_dir}}/references/interpreters.md). For the packages
installed in a session, see [packages.md]({{skill_dir}}/references/packages.md).

The **Arguments** and **Returns** entries below are generated from the running
build's command metadata, so they always match this Positron. The surrounding
guidance is hand-written.

## Controlling the active interpreter session

Both commands below act on the *foreground* session -- whichever session is
active right now. That can be a console session or a notebook session (a
notebook's session is the foreground while its editor tab is focused), so these
work for notebooks just as well as consoles. Neither has a precondition, so both
are always enabled; but when no session is running they do nothing and return no
value rather than reporting `disabled`. So don't infer from a successful call
that something happened: if you're not sure a session is running, list sessions
first (`getActiveSessions` in [sessions.md]({{skill_dir}}/references/sessions.md))
and, if the list is empty, tell the user there's no session to act on instead of
claiming you interrupted or restarted one. To switch to a different session or
start a new one, see [sessions.md]({{skill_dir}}/references/sessions.md).

### `workbench.action.languageRuntime.interrupt`

Interrupts the active interpreter runtime session -- e.g., stops a running
computation. Non-destructive: session state (variables, loaded packages) is
preserved. Try this first when code appears stuck (an infinite loop, a
long-running call the user wants to cancel).

{{command:workbench.action.languageRuntime.interrupt}}

### `workbench.action.language.runtime.restartActiveSession`

Restarts the active interpreter runtime session. **This discards all session
state** -- variables, loaded packages, and command history in that session are
lost. Always tell the user this will happen before calling it, and prefer
`interrupt` first when the goal is just to stop something running rather than
to get a clean session.

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

### `positron.help.readHelpTopic`

Reads the help page for a topic from a running interpreter session and returns
it to you as Markdown, including signatures, arguments, details, and examples.
Nothing is shown to the user; use `positron.help.lookupHelpTopic` above when the
user wants to see the page.

Read help before answering questions about how to call a specific function, what
its arguments mean, or why a call is failing, and before writing code against a
package you don't know well. This is especially important for packages that are
private, internal, or uncommon, since the installed help is the only reliable
source for them; it also reflects the exact version installed in the session.

Pass `languageId` (`r` or `python`) when the topic belongs to a language other
than the foreground session's. For R, pass the package in `package` rather than
writing `pkg::topic`. For Python, pass the import path as the topic (for example
`pandas.DataFrame.merge`). If `found` is false, relay or act on `message`; for
an R topic that is ambiguous or not found, retry with `package`.

{{command:positron.help.readHelpTopic}}

### `positron.help.listPackageDocs`

Lists the documentation for an installed package: its help topics (with titles)
and its vignettes, the long-form guides that explain a package's workflow. Use
it to get oriented in a package you don't know, especially a private or internal
one, or when you need a help topic or vignette name you can't guess. For R,
each topic's `aliases` are the function names it documents; pass one of those
with `package` to `positron.help.readHelpTopic`. For Python, topics are the
package's public members, given as full import paths, and the README is the only
vignette.

{{command:positron.help.listPackageDocs}}

### `positron.help.readVignette`

Reads a vignette and returns it as Markdown. Vignette names are not guessable,
so get them from `positron.help.listPackageDocs` first. Read a vignette when the
user wants to learn how to use a package or asks about its intended workflow,
rather than about a single function. Vignettes can be long, so read one only
when it is relevant to the question.

{{command:positron.help.readVignette}}
