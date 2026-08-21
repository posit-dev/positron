---
name: positron-commands
description: >
  Running Positron IDE commands: changing the window layout, focusing panes
  (Console, Variables, Plots, Help, Packages), clearing the console, adjusting
  the Data Explorer view, discovering or restarting R and Python interpreters,
  interrupting a stuck session, and reading, installing or updating the
  packages installed in a session. Use when the user wants Positron itself to
  do something, or wants to know what is installed in the session, rather than
  wanting R or Python code run. Load this skill, then read the reference file
  for the area in question. Triggers: "switch to the data science layout",
  "show me the variables pane", "my R interpreter isn't showing up", "my
  session is stuck", "is pandas installed?", "install dplyr", "update all my
  packages".
---

# Positron IDE commands

These commands act on the Positron workbench itself -- layout, panes, interpreter
sessions, and packages. They do not run R or Python code; use `executeCode` for
that.

## Calling these commands

Invoke commands with the `positronCommand` tool, passing the command's literal
`id` exactly as written in the reference files -- copy it, do not retype it from
memory. Where a command takes arguments, fill `args` positionally in the order
given under that command's "Arguments" entry. Omit `args` entirely for commands
that take none -- do not pass an empty object or array. Never invent an argument
value the user hasn't given you or that isn't documented; if a required value is
unknown, ask the user first.

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

**Interpreters and sessions** -- [references/troubleshooting.md]({{skill_dir}}/references/troubleshooting.md)
Read when the user asks about: an interpreter that isn't showing up or won't
start, startup diagnostics, or a session that is stuck or needs restarting.
Also covers looking up a help topic for a function or symbol.

**Packages** -- [references/packages.md]({{skill_dir}}/references/packages.md)
Read when the user asks about: what is installed in a session and at which
version, whether a package is available or out of date, or installing and
updating packages. Read it **before** answering any question about what the
session has -- it documents the command that reports the installed packages,
which is always the right way to find out, rather than running code to check.
