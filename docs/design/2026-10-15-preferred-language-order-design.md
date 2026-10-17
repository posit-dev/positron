# Preferred language order

Issue: https://github.com/posit-dev/positron/issues/15999

**Summary:** Add a setting that picks which language comes first in the session and
language pickers. Today that's always Python. Leaving the setting unset keeps today's
order.

## What I'd like feedback on

Leave comments inline on the lines they're about. These are the open decisions:

1. **Setting or inference?** We already have a lot of settings. "Alternatives considered"
   below explains why I still think a setting is the right call.
2. **Name.** `interpreters.preferredLanguage` puts it in the Interpreters group of the
   Settings editor, where users already go. Something like `languages.preferred` would fit
   better if we later extend it beyond pickers (Julia's whole-IDE comment on the issue),
   but it starts a new namespace.
3. **Dropdown or free text?** A dropdown (Python, R) is the simplest for users, but Julia
   and other third-party languages can't be picked until we add them. Adding values later
   doesn't break anyone, so I'm leaning dropdown.
4. **Audience.** I'm assuming this is mostly for people who work in one language. If people
   who use both need a full custom order, a list setting would fit better.

## Problem

In the session picker, Python always comes before R. Nobody decided that; the picker sorts
alphabetically ("Python" < "R"). The first entry is pre-selected, so an R user has to
arrow past Python every time they start a session, and there's no way to change it.

## Proposal

Add one setting, `interpreters.preferredLanguage`, a dropdown with Default, Python, and R.

- The chosen language goes first in the pickers below. Other languages keep alphabetical
  order after it.
- Default is today's order, so nobody sees a change unless they set it.
- It's a normal setting, so you can also set it per project in `.vscode/settings.json`.
  For example, someone who mostly works in Python could put R first in their R package
  repo.
- It only changes display order. It doesn't change which interpreter starts automatically.

## Where users see it

Both places are lists where the first entry is pre-selected, so order changes what Enter
does. Screenshots show today's order. With R preferred, R moves ahead of Python in each.

**1. Start Session picker.** R moves above Python in the Suggested list, and the R section
moves above the Python sections. Versions within a language keep their order.

![Start Session picker](images/preferred-language-start-session-picker.png)

One change covers every place this picker opens from:
- The top bar session button
- The Console's **+** button
- The notebook kernel picker (Positron Notebooks and legacy Jupyter notebooks)
- The Quarto kernel picker

**2. Execute Code in Console (Command Palette).** Its language prompt lists R first. Few
people use this one.

![Execute Code language prompt](images/preferred-language-execute-code-prompt.png)

## Alternatives considered

**Inferring the preference instead of adding a setting.** I looked for something Positron
already tracks that we could read the preference from. Nothing works across workspaces:

- The last-used interpreter (`positron.affiliatedRuntimeMetadata.v2.<lang>`) is stored per
  workspace.
- Project detection (`.Rproj`, `renv.lock`, `.venv`) is also per workspace, and it lives
  inside the language extensions.
- The active session's language changes constantly, so the order would jump around within
  a window.
- `interpreters.startupBehavior` per-language overrides are rarely set.

A global signal would mean new hidden state, such as a stored "last started language".
That would reorder the list for anyone who uses both languages, and they'd have no way to
see why or to pin an order. Inference could still come later as the fallback when the
setting is unset.

**Sorting by recent use.** I ruled this out for the same reason: the order would keep
changing.

## Implementation

### The setting

Registered next to `interpreters.startupBehavior` in
`src/vs/workbench/services/languageRuntime/common/languageRuntime.ts`:

```ts
'interpreters.preferredLanguage': {
	type: 'string',
	enum: ['', 'python', 'r'],
	enumItemLabels: ['Default', 'Python', 'R'],
	enumDescriptions: [
		"Languages are listed alphabetically.",
		"Python is listed first.",
		"R is listed first.",
	],
	default: '',
	description: "The language to list first when picking an interpreter or language.",
	tags: ['interpreterSettings'],
}
```

The values are language IDs, the same ones as `ILanguageRuntimeMetadata.languageId`. The
setting uses window scope (the default), so it can be set per workspace. Application scope
would make it user-only, but per-project overrides cost nothing and are what users expect
from a setting.

### Shared ordering helper

New file `src/vs/workbench/services/languageRuntime/common/languageOrder.ts`:

```ts
export const PREFERRED_LANGUAGE_KEY = 'interpreters.preferredLanguage';

/** Preferred language first, then by name. */
export function compareLanguages(
	a: { languageId: string; languageName: string },
	b: { languageId: string; languageName: string },
	preferredLanguageId: string | undefined,
): number
```

The function is pure. Callers read the setting with `configurationService.getValue` every
time they build a list, not once at construction, so a change shows up the next time a
picker opens.

### Call sites

| Surface | Today | Change |
|---|---|---|
| Start Session picker (all entry points) | `createInterpreterGroups` sorts by `languageName` (`languageRuntimeActions.ts:553`) | Sort with `compareLanguages`. This one change covers every entry point and both the Suggested and per-language sections. |
| Execute Code language prompt | `selectLanguage` sorts by label (`languageRuntimeActions.ts:200`) | Sort with `compareLanguages` |

## Testing

- **Vitest for `compareLanguages`.** Check the unset case (alphabetical), R preferred,
  Python preferred (same as today), and an unknown language ID (falls back to
  alphabetical).
- **Manual.** Set the setting to R and check each surface above. Then unset it and confirm
  nothing changed.
- **No new e2e test.** The default order doesn't change, so existing picker e2e tests
  should still pass.

## Notes: places left out

These also show Python before R. I looked at each and decided not to change it.

- **New Folder from Template cards.** All four cards are visible at once and none is
  pre-selected, so order is only cosmetic. Moving them would also break muscle memory, and
  keeping Jupyter next to Python makes an R-first layout awkward.
- **Welcome page environment setup.** Two rows you take in at a glance, nothing selected.
  Same reasoning as New Folder.
- **File > New File menu.** The Python and R entries come from the extensions' menu
  contributions, so changing their order would be a separate extension change.
- **Console session dropdown, Sessions pane, "Running Interpreter Sessions".** These list
  running sessions by recent use or creation time, not by language, and that seems right.
