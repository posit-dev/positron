# Positron registered interpreter commands

Listing the interpreters registered with Positron -- Python, R, and any other
language a user has added -- and rescanning when a newly installed one hasn't
appeared yet. See [SKILL.md]({{skill_dir}}/SKILL.md) for how to call these commands and
how to handle failures.

An interpreter being *registered* means Positron knows about it and can start a
session for it; it does not mean a session is running. To start or switch a
session, or to recover one that's misbehaving, see
[troubleshooting.md]({{skill_dir}}/references/troubleshooting.md).

## Listing available interpreters

### `workbench.action.language.runtime.getRegisteredRuntimes`

Lists the interpreters registered with Positron, across all languages. This is
how you answer "what interpreters are available" and how you find a base
interpreter before creating an environment or starting a session. Read-only and
always enabled. Pass a `languageId` (e.g. `"python"` or `"r"`) to narrow the
results to one language; omit it to get every language.

An empty array means no interpreter of the requested language is registered. If
you expected one to be there, force a rescan with
`workbench.action.language.runtime.discoverAllRuntimes` (below) and list again
before concluding it's missing.

Each entry's `runtimeId` is the internal id you pass to
`workbench.action.language.runtime.startNewConsoleSession` (see
[troubleshooting.md]({{skill_dir}}/references/troubleshooting.md)) to start a session
for that interpreter. It appears nowhere in the Positron UI, so use it to make
the call but never show it to the user -- refer to the interpreter by name.

{{command:workbench.action.language.runtime.getRegisteredRuntimes}}

## Diagnosing why an interpreter isn't showing up

### `workbench.action.language.runtime.discoverAllRuntimes`

Rediscovers all installed interpreters so newly installed environments become
available. Positron only scans for interpreters at certain points, so a
freshly installed environment (a new Python, R, or other-language interpreter)
may not appear until a rescan is forced. No precondition -- always enabled.

{{command:workbench.action.language.runtime.discoverAllRuntimes}}

### `positron.startupDiagnostics.show`

Opens the runtime startup diagnostics editor to inspect interpreter
discovery output. Use this when a rescan alone doesn't surface the missing
interpreter, or when you need to show the user *why* discovery failed rather
than just retrying blindly -- it displays the actual discovery log. No
precondition -- always enabled.

{{command:positron.startupDiagnostics.show}}

**Worked flow -- "my interpreter isn't showing up":**

1. Call `workbench.action.language.runtime.discoverAllRuntimes` to force a
   fresh scan.
2. Call `workbench.action.language.runtime.getRegisteredRuntimes` to check
   whether the interpreter now appears. If it does, you're done.
3. If it still doesn't appear, call `positron.startupDiagnostics.show` to
   open the startup diagnostics editor, and report what it shows rather than
   guessing at the cause.

Do not reach for `workbench.action.language.runtime.restartActiveSession` as
part of this flow -- restarting is for recovering a session that's already
running, not for interpreter discovery, and it discards session state.
