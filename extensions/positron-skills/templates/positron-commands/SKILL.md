---
name: positron-commands
description: >
  Running Positron IDE commands: changing the window layout, focusing panes
  (Console, Variables, Plots, Help, Packages), clearing the console, opening a
  file or a data file in the right editor, listing or discovering registered
  interpreters, restarting or interrupting a stuck session, setting up Python,
  and reading, installing or updating the packages in a session. Use when the
  user wants Positron itself to do something, or wants to know what is
  installed, rather than to run R or Python code. Triggers: "switch to the data
  science layout", "show the variables pane", "clear the console", "open
  data.csv", "let's look at this parquet file", "what interpreters are
  available", "my R interpreter isn't showing up", "my session is stuck", "is
  pandas installed?", "install dplyr", "update all my packages", "do I have any
  vulnerable packages?", "I don't have Python installed", "set up a Python
  environment", "which Python am I using".
---

# Positron IDE commands

These commands act on the Positron workbench itself -- layout, panes, editors,
interpreter sessions, and packages. They do not run interpreter code; use
`executeCode` for that.

## Calling these commands

Invoke commands with the `positronCommand` tool, passing the command's literal
`id` exactly as written in the reference files -- copy it, do not retype it from
memory. Where a command takes arguments, fill `args` positionally in the order
given under that command's "Arguments" entry. Omit `args` entirely for commands
that take none -- do not pass an empty object or array. Never invent an argument
value the user hasn't given you or that isn't documented; if a required value is
unknown, ask the user first.

**Find the id here before you run it.** Positron is built on VS Code, so a
plausible-sounding VS Code command id usually does exist and will usually run --
which makes recalling one from memory the most expensive mistake available. Some
ids that read like they do the thing directly instead open a dialog or a
quick-pick and wait for the user to choose, so the command "succeeds" while
handing the task straight back to them. Read the relevant reference file first
and use the id and arguments it gives you. If what the user wants is not covered
by any file below, say so rather than reaching for an id from general VS Code
knowledge.

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

**Opening files** -- [references/files.md]({{skill_dir}}/references/files.md)
Read when the user wants a file open in Positron: "open data.csv", "show me
that file", "let's look at this CSV/Parquet/Excel file", or anything that should
land in the Data Explorer. Read it **before** opening anything -- it documents
the one command that opens a known path, and names the similar-looking ids that
open a file picker instead and hand the task back to the user.

**Registered interpreters** -- [references/interpreters.md]({{skill_dir}}/references/interpreters.md)
Read when the user asks what interpreters are available, wants the registered
interpreters listed (Python, R, or another language), or needs Positron to
rescan for newly installed environments. Also the place to find a base
interpreter before creating an environment.

**Sessions** -- [references/troubleshooting.md]({{skill_dir}}/references/troubleshooting.md)
Read when the user asks about a session that is stuck, needs interrupting, or
needs restarting. Also covers looking up a help topic for a function or symbol.

**Packages** -- [references/packages.md]({{skill_dir}}/references/packages.md)
Read when the user asks about: what is installed in a session and at which
version, whether a package is available, out of date or affected by a known
security advisory, or installing and updating packages. Read it **before**
answering any question about what the session has -- it documents the command
that reports the installed packages, which is always the right way to find out,
rather than running code to check.

**Python environment setup** -- [references/python-setup.md]({{skill_dir}}/references/python-setup.md)
Read when the user is getting Python set up: installing a Python interpreter when
they have none, creating a project environment (venv, Conda, or uv), or finding
out which interpreter is currently active.
