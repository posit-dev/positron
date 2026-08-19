# Positron Python environment setup commands

Getting a user's Python environment ready during onboarding: installing a Python
interpreter, creating a project environment, and finding out which interpreter is
active. See [SKILL.md]({{skill_dir}}/SKILL.md) for how to call these commands and how to
handle failures.

The **Arguments** and **Returns** entries below are generated from the running
build's command metadata, so they always match this Positron. The surrounding
guidance is hand-written.

These commands come from the Python extension, so they only exist once it is
active -- expect `not-found` if Python support isn't loaded yet. To start or
switch a session once an interpreter exists, use the session commands in
[troubleshooting.md]({{skill_dir}}/references/troubleshooting.md).

## Finding the active interpreter

### `python.interpreterPath`

Returns the path to the Python interpreter currently active in the workspace.
Read-only and takes no arguments -- use it before running Python code or creating
an environment to see what's already selected. It returns the literal string
`python` when nothing is selected, which is the signal that setup is still
needed. The path comes back shell-quoted (ready to drop into a command line), so
strip surrounding quotes if you need the bare path.

{{command:python.interpreterPath}}

## Installing Python from scratch

### `python.installPythonViaUv`

Installs a Python interpreter with uv, registers it with Positron, and starts it
in the Console. This is the onboarding path when `python.interpreterPath` returns
`python` (nothing selected) or the only interpreter is the system Python and the
user wants a clean one. It prompts the user to choose a version and shows
progress, so it is not instant; there is nothing to pass. Prefer it over telling
the user to install Python by hand in a terminal.

{{command:python.installPythonViaUv}}

## Creating a project environment

### `python.createEnvironmentAndRegister`

Creates an isolated Python environment (venv, Conda, or uv), registers it with
Positron, and selects it. Use this when an interpreter already exists and the
user wants a per-project environment rather than working against a global Python.

You can let it prompt for everything, or drive it non-interactively by passing
`providerId` together with exactly one Python source:

- **venv** (`ms-python.python:venv`): pass `interpreterPath` -- the existing
  interpreter to base the venv on. Get a candidate from `python.interpreterPath`.
- **Conda** (`ms-python.python:conda`): pass `condaPythonVersion`, e.g. `"3.12"`.
- **uv** (`ms-python.python:uv`): pass `uvPythonVersion`, e.g. `"3.12"`.

Passing a `providerId` with no source triggers the interactive prompts instead.
If the user has no Python at all, install one first with
`python.installPythonViaUv` rather than pointing this command at a version it
would have to download.

{{command:python.createEnvironmentAndRegister}}
