---
name: positron-commands
description: >
  Running Positron IDE commands: changing the window layout, focusing panes
  (Console, Variables, Plots, Help, Packages), clearing the console, listing or
  discovering registered interpreters, listing running sessions, switching or
  starting a session, restarting or interrupting a stuck one, and refreshing or
  updating packages. Use when the user wants Positron itself to do something,
  rather than to run R or Python code. Load this skill, then read the reference
  file for the area: panes and layout in references/ui.md; interpreters in
  references/interpreters.md; sessions in references/sessions.md; stuck sessions,
  packages, and help in references/troubleshooting.md; Python setup in
  references/python-setup.md.
  Triggers: "switch to the data science layout", "show the variables pane",
  "clear the console", "what interpreters are available", "switch to my R
  session", "start a new Python session", "my session is stuck", "update all my
  packages", "set up a Python environment".
---

# Positron IDE commands

These commands act on the Positron workbench itself -- layout, panes, interpreter
sessions, and packages. They do not run interpreter code; use `executeCode` for
that.

## Calling these commands

Invoke commands with the `positronCommand` tool, passing the command's literal
`id` exactly as written in the reference files -- copy it, do not retype it from
memory. Where a command takes arguments, fill `args` positionally in the order
given under that command's "Arguments" entry. Omit `args` entirely for commands
that take none -- do not pass an empty object or array. Never invent an argument
value the user hasn't given you or that isn't documented; if a required value is
unknown, ask the user first.

Some commands take or return an internal id -- a runtime id or a session id.
These are opaque handles you pass back into another command; they are not shown
anywhere in the Positron UI, so a user won't recognize one and it would only
confuse them. Use ids to make the call, but never repeat one to the user. Refer
to a session or interpreter by its name instead.

## When a command doesn't work

- **`disabled`**: the command's precondition doesn't currently hold. Common
  causes are no running interpreter session, or no Data Explorer editor open.
  Report this plainly (e.g. "there's no Data Explorer editor open right now")
  rather than retrying or guessing at a workaround. Each reference file notes
  which of its commands have preconditions.
- **`not-found`**: the command id isn't present in this Positron build, meaning
  the build is older or newer than this skill expects. Report this plainly; do
  not substitute a similarly named id you're unsure about.

## Reference Files

Load the file covering the area in question -- the command ids, arguments, and
return values live there, not in this file.

**UI, layout and panes** -- [references/ui.md]({{skill_dir}}/references/ui.md)
Read when the user asks about: switching the workbench layout (four-pane,
notebook, two-pane), bringing a pane into focus (Console, Variables, Help,
Plots, Packages), clearing console output, or expanding/collapsing the Data
Explorer's column summary panel.

**Registered interpreters** -- [references/interpreters.md]({{skill_dir}}/references/interpreters.md)
Read when the user asks what interpreters are available, wants the registered
interpreters listed (Python, R, or another language), or needs Positron to
rescan for newly installed environments. Also the place to find a base
interpreter before creating an environment.

**Sessions** -- [references/sessions.md]({{skill_dir}}/references/sessions.md)
Read when the user asks about: which sessions are running, switching to a
different session, or starting a new one. Also explains the difference between
console sessions and notebook sessions, which decides whether a session can be
selected.

**Stuck sessions, packages, and help** -- [references/troubleshooting.md]({{skill_dir}}/references/troubleshooting.md)
Read when the user asks about: a session that is stuck or needs interrupting or
restarting, installed packages that need refreshing or updating, or looking up a
help topic for a function or symbol.

**Python environment setup** -- [references/python-setup.md]({{skill_dir}}/references/python-setup.md)
Read when the user is getting Python set up: installing a Python interpreter when
they have none, creating a project environment (venv, Conda, or uv), or finding
out which interpreter is currently active.
