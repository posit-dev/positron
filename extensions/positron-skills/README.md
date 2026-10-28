# Positron Skills

This extension publishes the agent skills that teach Positron Assistant which
Positron IDE commands exist and how to call them. It bundles skill *templates*,
fills in each command's mechanical facts from the running build, and registers
the result as a skill root the assistant reads.

A command's mechanical facts -- its argument shapes and return value -- already
have one source of truth: the command's registration in Positron.

However, these facts aren't enough. Auto-generated descriptions like "Focus
on Variables View" say nothing about *when* to use a command, and an argument
can be flagged required even though every property inside it is optional.

So the two are split in these templates:

- **Facts** (arguments, returns) come from live metadata via
  `positron.ai.getAgentAllowedCommands({ includeDisabled: true })`, expanded into
  the templates at activation. Never hand-copied, so they cannot drift.
- **Guidance** (when to use a command, worked flows, and corrections where the
  metadata is misleading) is authored by hand in the templates, keyed by command
  id.

A template carries one directive, naming a command id. It expands to the
command's Arguments and Returns sections, labels included:

```
{{command:workbench.panel.positronConsole.focus}}
```

Guidance that only applies in some environments goes in a block, with each
marker on its own line. The block is kept only when its flag is set in the
environment the skill is generated in:

```
{{if:web}}
Positron is running in a browser, so ...
{{endif}}
```

The one flag is `web` (Positron's UI runs in a browser). Add a flag only when
a passage needs it, and only for a fact that is fixed for the session, since
the output is not regenerated until the next launch; anything that can change
mid-session, such as a setting, belongs in prose that tells the model to check
it. Blocks don't nest and have no `else` or negation.

Everything else in a template is prose and passes through untouched, including
other `{{...}}` text such as Jinja in a code example.

## How it works

On activation (`onAiEnabled`, so it loads only once the `ai.enabled` setting is on):

1. Read the bundled templates under `templates/`.
2. Load command metadata, including commands disabled in the current UI state
   (so a Data Explorer command is documented even when no Data Explorer is open).
3. Keep the conditional blocks that apply to this environment, then expand
   each `{{command:id}}` directive.
4. Write the result to `<globalStorage>/skills` and register it via
   `positron.ai.registerAgentSkillRoot`.

Output is rewritten only when its inputs change: a digest of the Positron build,
the extension version, the environment flags, the templates, and the command
metadata is stored
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
- A malformed conditional block (an unknown flag, or an unmatched marker) is
  logged as a warning at generation time, and no marker reaches the output.
- `src/templateExpander.test.ts` covers the expansion itself, and fails on a
  malformed conditional block in any bundled template.
