# Positron interpreter, session and package commands

Diagnosing and recovering R and Python interpreter sessions, managing packages,
and looking up help topics. See [SKILL.md](../SKILL.md) for how to call these
commands and how to handle failures.

## Diagnosing why an interpreter isn't showing up

### `workbench.action.language.runtime.discoverAllRuntimes`

Rediscovers all installed interpreters so newly installed environments become
available. Positron only scans for interpreters at certain points, so a
freshly installed R or Python environment may not appear until a rescan is
forced.

- No arguments.
- No return value.
- No precondition — always enabled.

### `positron.startupDiagnostics.show`

Opens the runtime startup diagnostics editor to inspect interpreter
discovery output. Use this when a rescan alone doesn't surface the missing
interpreter, or when you need to show the user *why* discovery failed rather
than just retrying blindly — it displays the actual discovery log.

- No arguments.
- No return value (the command intentionally returns nothing; a live editor
  pane isn't serializable back to the caller).
- No precondition — always enabled.

**Worked flow — "my R/Python interpreter isn't showing up":**

1. Call `workbench.action.language.runtime.discoverAllRuntimes` to force a
   fresh scan.
2. If the interpreter now appears (e.g., in the interpreter picker), you're
   done.
3. If it still doesn't appear, call `positron.startupDiagnostics.show` to
   open the startup diagnostics editor, and report what it shows rather than
   guessing at the cause.

Do not reach for `workbench.action.language.runtime.restartActiveSession` as
part of this flow — restarting is for recovering a session that's already
running, not for interpreter discovery, and (as noted below) it discards
session state.

## Controlling the active interpreter session

### `workbench.action.languageRuntime.interrupt`

Interrupts the active interpreter runtime session — e.g., stops a running
computation. Non-destructive: session state (variables, loaded packages) is
preserved. Try this first when code appears stuck (an infinite loop, a
long-running call the user wants to cancel).

- No arguments.
- No return value.
- No precondition — always enabled.

### `workbench.action.language.runtime.restartActiveSession`

Restarts the active interpreter runtime session. **This discards all session
state** — variables, loaded packages, and command history in that session are
lost. Always tell the user this will happen before calling it, and prefer
`interrupt` first when the goal is just to stop something running rather than
to get a clean session.

- No arguments.
- No return value.
- No precondition — always enabled.

## Managing packages

### `positronPackages.refreshPackages`

Refreshes the list of installed packages in the active runtime session. Use
when a package was installed or removed outside of Positron (e.g., from a
terminal) and the Packages pane looks stale.

- No arguments.
- No documented return value (the underlying call does return package data,
  but no return contract is authored for it — treat any result as
  informational, not something to parse).
- Precondition: the Packages pane must be enabled by configuration, and a
  package operation must currently be able to run (in practice, this
  generally requires an active runtime session).

### `positronPackages.updateAllPackages`

Updates every installed package in the active runtime session to its latest
available version. Use when the user asks to update all their packages.
Updating can take a while for large environments — say so. If code that's
already running in the session doesn't reflect an update afterward, a session
restart may be needed for it to take effect; mention that possibility and, if
the user wants to proceed, use `workbench.action.language.runtime.restartActiveSession`
with the state-loss warning above.

- No arguments.
- No documented return value.
- Precondition: same as `refreshPackages` — Packages pane enabled and a
  package operation currently able to run.

## Looking up help topics

### `positron.help.lookupHelpTopic`

Shows help for a topic — typically a function or symbol name — in the Help
pane. Uses the language of the active editor, or of the foreground
interpreter session if no editor is open. Requires a running interpreter
session for that language to actually resolve the topic.

- Arguments:

  | name | required | schema | description |
  |---|---|---|---|
  | `topic` | true (per metadata; the underlying implementation treats a missing value as "prompt the user" in practice, but always pass it explicitly here) | `{ type: "string" }` | Bare function or symbol name to look up, e.g. `mean` |

- Returns: an object with `found`, `topic`, `languageId`, and `message`.
  `found` is `true` when the topic was shown in the Help pane, with `topic`
  and `languageId` confirming what was looked up and in which language. When
  `found` is `false`, `message` explains why — no topic provided, topic not
  found, no session for the language, or a lookup error. Relay `message` to
  the user rather than re-guessing the reason yourself.
- No precondition — the command itself is always enabled, but expect
  `found: false` (not `disabled`) if there's no running session for the
  relevant language.

Pass the topic exactly as the user names it (a bare function/symbol, e.g.
`mean`, not a sentence). If the user hasn't specified a topic, ask before
calling. To bring the Help pane into view after a lookup, use
`workbench.panel.positronHelp.focus` from [ui.md](ui.md).
