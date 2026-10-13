# Positron registered interpreter commands

Listing the interpreters registered with Positron -- Python, R, and any other
language a user has added -- rescanning when a newly installed one hasn't
appeared yet, and adding one that discovery missed. See
[SKILL.md]({{skill_dir}}/SKILL.md) for how to call these commands and how to
handle failures.

An interpreter being *registered* means Positron knows about it and can start a
session for it; it does not mean a session is running. To list, start, or switch
a session, see [sessions.md]({{skill_dir}}/references/sessions.md); to recover one
that's misbehaving, see [troubleshooting.md]({{skill_dir}}/references/troubleshooting.md).

## Listing available interpreters

### `workbench.action.language.runtime.getRegisteredRuntimes`

Lists the interpreters registered with Positron, across all languages. This is
how you answer "what interpreters are available" and how you find a base
interpreter before creating an environment or starting a session. Read-only and
always enabled. Pass a `languageId` (e.g. `"python"` or `"r"`) to narrow the
results to one language; omit it to get every language.

`affiliated: true` marks the interpreter this workspace uses for its language --
the one Positron starts when the project is opened. That is how you answer
"which interpreter does this project use". `runtimeSource` names where the
interpreter came from (`System`, `Conda`, `uv`, `Venv`, and so on).

An empty array means no interpreter of the requested language is registered. If
you expected one to be there, force a rescan with
`workbench.action.language.runtime.discoverAllRuntimes` (below) and list again
before concluding it's missing.

Each entry's `runtimeId` is the internal id you pass to
`workbench.action.language.runtime.startNewConsoleSession` (see
[sessions.md]({{skill_dir}}/references/sessions.md)) to start a session for that
interpreter. It appears nowhere in the Positron UI, so use it to make the call
but never show it to the user -- refer to the interpreter by name.

{{command:workbench.action.language.runtime.getRegisteredRuntimes}}

## Installing an interpreter

For Python, use the commands in
[python-setup.md]({{skill_dir}}/references/python-setup.md). Other languages
have no install command: point the user to the language's installer (for R,
https://positron.posit.co/r-installations), then rescan with
`workbench.action.language.runtime.discoverAllRuntimes` once it's installed.

## When an interpreter isn't showing up

### `workbench.action.language.runtime.discoverAllRuntimes`

Rediscovers all installed interpreters so newly installed environments become
available. Positron only scans for interpreters at certain points, so a
freshly installed environment may not appear until a rescan is forced. No
precondition -- always enabled.

{{command:workbench.action.language.runtime.discoverAllRuntimes}}

### `workbench.action.language.runtime.registerRuntimeFromPath`

Hands the interpreter at a path to the language's extension, which registers it
and saves the path in its settings so it stays available in later sessions. Use
it when a rescan didn't find an interpreter the user knows is installed, or when
the user asks to make a specific interpreter available. The path must be the
interpreter executable (e.g. `.../bin/python` or `.../bin/R`), not its folder;
if the user names an environment rather than a path, find the executable first
(for example with `which` or the environment manager's own listing).

If the interpreter can't be used, the command fails with an error that says why
-- an unsupported version, an exclusion setting, a broken installation. Relay
that reason to the user; it is the answer to "why can't I see it". An error
saying no manager supports this means the language's extension doesn't offer
registration by path.

An interpreter inside an environment (Conda, Pixi, a venv) can be registered by
the executable's path: the language's extension recognizes the environment from
it and activates the environment when a session starts. If the user expects
Positron to find a whole class of environments on its own, check with the
`positron-settings` skill whether the language has a discovery setting for that
environment manager, and tell the user which one to enable.

{{command:workbench.action.language.runtime.registerRuntimeFromPath}}

### `positron.startupDiagnostics.show`

Opens the runtime startup diagnostics editor, which shows the user the
discovery settings, the discovered interpreters, and the language extensions'
logs. You can't read the editor yourself; open it when the user wants to dig
into discovery, or when the steps below leave the cause unexplained. No
precondition -- always enabled.

{{command:positron.startupDiagnostics.show}}

**Worked flow -- "my interpreter isn't showing up":**

1. Call `workbench.action.language.runtime.discoverAllRuntimes` to force a
   fresh scan.
2. Call `workbench.action.language.runtime.getRegisteredRuntimes` to check
   whether the interpreter now appears. If it does, you're done.
3. If it still doesn't appear and you know its path, call
   `workbench.action.language.runtime.registerRuntimeFromPath`. Either it is
   now registered, or the error tells you why it can't be used.
4. If the cause is still unclear, open `positron.startupDiagnostics.show` for
   the user rather than guessing.

Do not reach for `workbench.action.language.runtime.restartActiveSession` as
part of this flow -- restarting is for recovering a session that's already
running, not for interpreter discovery, and it discards session state.
