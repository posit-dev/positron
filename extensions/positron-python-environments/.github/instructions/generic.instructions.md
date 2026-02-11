---
applyTo: '**'
---

Provide project context and coding guidelines that AI should follow when generating code, answering questions, or reviewing changes.# Coding Instructions for vscode-python-environments

## Localization

-   Localize all user-facing messages using VS Code’s `l10n` API.
-   Internal log messages do not require localization.

## Logging

-   Use the extension’s logging utilities (`traceLog`, `traceVerbose`) for internal logs.
-   Do not use `console.log` or `console.warn` for logging.

## Settings Precedence

-   Always consider VS Code settings precedence:
    1. Workspace folder
    2. Workspace
    3. User/global
-   Remove or update settings from the highest precedence scope first.

## Error Handling & User Notifications

-   Avoid showing the same error message multiple times in a session; track state with a module-level variable.
-   Use clear, actionable error messages and offer relevant buttons (e.g., "Open settings", "Close").

## Documentation

-   Add clear docstrings to public functions, describing their purpose, parameters, and behavior.
