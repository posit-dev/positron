# Positron session commands

Listing the interpreter sessions that are running, switching between them, and
starting a new one. See [SKILL.md]({{skill_dir}}/SKILL.md) for how to call these
commands and how to handle failures. To interrupt or restart a stuck session,
see [troubleshooting.md]({{skill_dir}}/references/troubleshooting.md).

The **Arguments** and **Returns** entries below are generated from the running
build's command metadata, so they always match this Positron. The surrounding
guidance is hand-written.

## Console sessions vs notebook sessions

A *session* is one running instance of an interpreter. Positron has two kinds,
and the difference decides which command applies:

- **Console sessions** back a console in the Console pane. These are the
  interactive R and Python sessions a user runs code in at the prompt. One of
  them is the *foreground* session -- the one the console shows and the one the
  interrupt, restart, and clear-console commands act on. "Switch to my R
  session", "start a new Python session", and "which session is active" are all
  about console sessions.
- **Notebook sessions** are the kernels behind notebooks open in the editor --
  one per open notebook. They are not consoles; a user works in a notebook
  session by editing its notebook, not by typing at the console prompt.

`getActiveSessions` reports both kinds, tagged by `sessionMode` (`console` or
`notebook`). The commands here that change the active session are for **console
sessions only**:

- To switch the active console, pick an entry whose `sessionMode` is `console`
  and pass it to `selectSession`.
- You cannot make a notebook session the foreground session this way. A notebook
  session is tied to its open notebook, so the way to work in it is to switch to
  that notebook's editor tab -- not `selectSession`. If the user asks to switch
  to a notebook's session, tell them to open or click that notebook's tab; don't
  pass a notebook `sessionId` to `selectSession`.

Only `selectSession` is console-only. Interrupting and restarting (see
[troubleshooting.md]({{skill_dir}}/references/troubleshooting.md)) act on whichever
session is the foreground, so they work on a notebook session too once its
editor tab is focused.

Session ids and runtime ids are internal handles that appear nowhere in the
Positron UI. Use them to make a call, but never show one to the user -- refer to
a session or interpreter by its name. See the id rule in
[SKILL.md]({{skill_dir}}/SKILL.md).

## Listing sessions

### `workbench.action.language.runtime.getActiveSessions`

Lists the sessions currently running -- both console and notebook. This is how
you find the `sessionId` for `selectSession`, and how you confirm a session
exists before interrupting or restarting. Read-only and always enabled. Pass a
`languageId` (e.g. `"python"` or `"r"`) to narrow the results to one language;
omit it for every language. In each entry, `sessionMode` tells console from
notebook, `foreground: true` marks the active console session, and `sessionName`
is the name to use when talking to the user. An empty array means nothing is
running.

{{command:workbench.action.language.runtime.getActiveSessions}}

## Switching the active session

### `workbench.action.language.runtime.selectSession`

Makes an already-running **console** session the foreground session. Use when
the user wants to switch to a console session they already have open. Call
`getActiveSessions` first, pick the entry whose `sessionMode` is `console` and
whose name matches what the user asked for, and pass its `sessionId`. Don't pass
a notebook session's id (see the distinction above), and don't call this without
an id -- that opens a picker and waits on the user. A `selected: false` result
means the picker was dismissed; report that rather than retrying.

{{command:workbench.action.language.runtime.selectSession}}

## Starting a new session

### `workbench.action.language.runtime.startNewConsoleSession`

Starts a brand-new console session for a registered interpreter. Use when the
user wants a fresh session rather than switching to one they already have. It
needs the `runtimeId` of a registered interpreter, which comes from
`workbench.action.language.runtime.getRegisteredRuntimes` in
[interpreters.md]({{skill_dir}}/references/interpreters.md) -- list the interpreters,
match the one the user asked for, and pass its `runtimeId`. Don't call this
without an id -- that opens a picker and waits on the user. A `started: false`
result means the picker was dismissed; report that rather than retrying.

{{command:workbench.action.language.runtime.startNewConsoleSession}}
