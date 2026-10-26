# Positron Coding Agent Common

Shared helpers for Positron's built-in coding agent integrations, such as
`positron-claude-code`. This is a build-time-only package, not an extension:
each integration depends on it with a `file:` dependency and esbuild bundles
it in.

## What goes here

Anything a second integration (e.g. a `positron-codex`) would need to do the
same job: building the prompt for an error action, finding and launching the
agent's command-line tool, opening its terminal, and explaining problems the
user can fix.

What's specific to one agent stays in its integration: how it decides between
its chat and a terminal, how it opens its chat, its settings, and its
messages.

## No runtime `vscode` or `positron` imports

Only `import type` from `vscode` and `positron`. When an integration runs
from source, this package is loaded through a symlink from outside the
integration's folder, and a `require('vscode')` from there gets an API
without the integration's identity, so its proposed APIs fail. Take the API
objects the code needs (e.g. `vscode.window`, `vscode.l10n`) as parameters
instead.
