---
name: agent-compatible-command
description: Use when making a Positron command invocable by Posit Assistant (agent-compatible) - reviews the command, decides whether it can be made agent-invocable in place, lists the exact edits, and applies them. Triggers on "make this command agent-compatible", "agentCompatible", "let the assistant run this command".
---

# Making a Positron command agent-invocable

Posit Assistant runs Positron commands through its `positronCommand` tool. It embeds
the curated list from `positron.ai.getAgentAllowedCommands()` in its system prompt and
executes a chosen command via `positron.ai.validateAndExecuteCommand(id, args)`, so a
command is only usable by the assistant if it is advertised by that endpoint and can run
without prompting. This skill makes one command agent-invocable using the project
pattern (see `docs/superpowers/specs/2026-07-17-agent-invocable-commands-design.md`).

## The pattern

One command, one code path. The command prompts only for what it was not given:
no arguments -> the existing picker/input box (a user); arguments supplied -> run
headless (an agent). You annotate the command and, if it takes new arguments, add
them as optional parameters that skip the prompt when present.

## Steps

1. **Locate the command.** Find its registration (`registerAction2`/`Action2` or
   `CommandsRegistry.registerCommand`). Note its id and its `run()` signature. Palette
   exposure (`f1: true`) is NOT required: the endpoint advertises any `agentCompatible`
   command whose precondition currently holds, palette or not.

2. **List non-test call sites.** Search for `executeCommand('<id>')` and menu
   contributions. Record what each caller passes.

3. **Apply the decision rule.**
   - If no caller passes the argument an agent would supply (the usual case: the
     command is argless and opens a picker), add an OPTIONAL typed parameter and only
     prompt when it is missing.
   - If a caller passes the SAME argument an agent would (so argument-presence cannot
     tell a user from an agent - for example a destructive command whose UI also
     passes the item id), STOP and ask the user how to proceed. Do not silently change
     the shared behavior. (This is why `uninstallPackage` was dropped from scope.)

4. **Report the exact edits before applying:**
   - `agentCompatible: true` and a `description` in the command's `metadata`.
   - `args`: one entry per positional argument, each with a `name`, a `description`,
     a JSON `schema` (for example `{ type: 'string' }`), and `isOptional: true` for
     optional ones.
   - **Never set `constraint`** on these args. `constraint` is enforced at runtime on
     every invocation and would reject existing callers (for example menu callers that
     pass a context object). `schema` is documentation for the model and is not
     enforced.
   - Optionally a `returns` string when the command returns something useful.
   - The `run()` change: accept the new optional parameter(s) and prompt only when a
     parameter is missing (`const x = arg ?? await prompt()`).

   The `description`, each arg's `description`/`schema`, and `returns` are shown to the
   model verbatim in the assistant's system prompt, so write them for that reader. An
   arg is treated as required unless you set `isOptional: true`.

5. **Apply the edits with the user, then verify:**
   - `npm run build-check` is clean.
   - In the running app, "Developer: Show All Agent-Compatible Commands" lists the
     command with the expected `args`.
   - Calling the command with arguments runs without a prompt; calling it with none
     still prompts (unchanged for users).

## Worked references

- In place, argless -> optional arg: `positron.help.lookupHelpTopic` (a `topic?` param).
- Already argument-driven, add a documented value: `positronPackages.updatePackage`
  (agent passes `version`, using `'latest'` for the newest; name-only still prompts).
