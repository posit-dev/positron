# Positron Skills

This extension publishes the agent skills that teach Positron Assistant which
Positron IDE commands exist and how to call them. It bundles skill *templates*,
fills in each command's mechanical facts from the running build, and registers
the result as a skill root the assistant reads.

## The decision: facts are generated, guidance is hand-written

A command's mechanical facts -- its argument shapes and return value -- already
have one source of truth: the command's registration in Positron. Re-typing
them into prose would create a second copy that drifts the moment the code
changes. So we do not hand-copy them.

The metadata alone is also not enough. Auto-generated descriptions like "Focus
on Variables View" say nothing about *when* to use a command, and an argument
can be flagged required even though every property inside it is optional. Those
judgments can only be written by a person.

So the two are split:

- **Facts** (arguments, returns) come from live metadata via
  `positron.ai.getAgentAllowedCommands({ includeDisabled: true })`, expanded into
  the templates at activation. Never hand-copied, so they cannot drift.
- **Guidance** (when to use a command, worked flows, and corrections where the
  metadata is misleading) is authored by hand in the templates, keyed by command
  id.

A template carries two directives, each naming a command id:

```
**Arguments:** {{args:workbench.panel.positronConsole.focus}}
**Returns:** {{returns:workbench.panel.positronConsole.focus}}
```

Everything else in a template is prose and passes through untouched.

## How it works

On activation (`onStartupFinished`, gated on the `ai.enabled` setting):

1. Read the bundled templates under `templates/`.
2. Load command metadata, including commands disabled in the current UI state
   (so a Data Explorer command is documented even when no Data Explorer is open).
3. Expand each `{{args:id}}` / `{{returns:id}}` directive.
4. Write the result to `<globalStorage>/skills` and register it via
   `positron.ai.registerAgentSkillRoot`.

Output is rewritten only when its inputs change: a digest of the Positron build,
the extension version, the templates, and the command metadata is stored
alongside the output, so an ordinary launch does no writing. The write is staged
in a sibling directory and swapped in, so the assistant never reads a
half-written root.

## Adding or changing a skill

Edit the templates under `templates/`. Add a `<skill-name>/SKILL.md` with a
short router and `references/*.md` files for each area. Name each command by its
literal id in a `### \`id\`` heading, write the guidance, and add the two
directives for its facts. That is all -- the facts fill themselves in.

## Drift protection

- A directive naming a command the build does not provide expands to an empty
  facts block and is logged as a warning at generation time.
- `agentSkillDrift.vitest.ts` (in `positronAiFeatures`) fails when a command id
  named in a template no longer resolves in the workbench source.
- `src/templateExpander.test.ts` covers the expansion itself.
