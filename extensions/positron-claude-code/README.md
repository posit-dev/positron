# Positron Claude Code Integration

This extension integrates Claude Code with Positron. It registers Claude Code
with `positron.ai.registerErrorActionHandler` (proposed API
`positronErrorActions`), so the user can choose it in the
`ai.errorActions.agent` setting and send errors to it with Fix and Explain.

## Activation

The extension registers Claude Code during activation, as VS Code expects of
commands and tools, so it awaits the check for whether Claude Code is
installed. It activates on `onAiEnabled`, so Claude Code is registered, and
listed in the setting, before anyone clicks; the setting lists only installed
agents.
