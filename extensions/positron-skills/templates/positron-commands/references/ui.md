# Positron UI commands

Layout, pane focus, and view state in the running Positron workbench. See
[SKILL.md](../SKILL.md) for how to call these commands and how to handle
failures.

The **Arguments** and **Returns** entries below are generated from the running
build's command metadata, so they always match this Positron. The surrounding
guidance is hand-written.

## Switching the overall layout

These three commands each switch the entire workbench to a different named
layout. They are mutually exclusive with each other (each is a full layout
swap, not an incremental change), but not with anything else in this file --
you can freely follow one with a focus command. None of them take arguments,
return a value, or have a precondition; all three are always enabled.

### `workbench.action.positronFourPaneDataScienceLayout`

Switches to the four-pane stacked data-science layout: explorer, editor,
console + terminal, variables + plots. This is the general-purpose default --
use it when the user wants "the standard" or "normal" data science layout, or
asks to see everything at once.

**Arguments:** {{args:workbench.action.positronFourPaneDataScienceLayout}}

**Returns:** {{returns:workbench.action.positronFourPaneDataScienceLayout}}

### `workbench.action.positronNotebookLayout`

Switches to the notebook layout: optimized for working in a single notebook,
with the console panel hidden. Use when the user is primarily editing a
notebook and wants more screen space, or explicitly asks for a
notebook-focused layout.

**Arguments:** {{args:workbench.action.positronNotebookLayout}}

**Returns:** {{returns:workbench.action.positronNotebookLayout}}

### `workbench.action.positronTwoPaneDataScienceLayout`

Switches to the side-by-side data-science layout: editor plus a wide session
panel containing variables and plots. Use when the user wants to compare code
and variables/plots side by side rather than stacked, e.g. "put the variables
next to my code."

**Arguments:** {{args:workbench.action.positronTwoPaneDataScienceLayout}}

**Returns:** {{returns:workbench.action.positronTwoPaneDataScienceLayout}}

## Focusing a specific pane

Each of these brings one view into focus without changing the overall layout.
All five take the same single argument, `focusOptions`. The command metadata
marks `focusOptions` as required -- any argument without an explicit "optional"
flag is reported that way -- even though every property inside the object is
itself optional (the generated Arguments entry shows this: `preserveFocus?`).
In practice this means: pass `{}` unless the user specifically wants the pane to
become visible without stealing keyboard focus away from where they're currently
typing, in which case pass `{ preserveFocus: true }`. None of the five have a
precondition; all are always enabled. Their metadata descriptions are
auto-generated ("Focus on {View} View") and don't convey when to use them --
the guidance below fills that gap.

### `workbench.view.positronPackages.view.focus`

Focuses the Packages pane. Use after installing, updating, or removing
packages, or whenever the user asks to see what's installed.

**Arguments:** {{args:workbench.view.positronPackages.view.focus}}

**Returns:** {{returns:workbench.view.positronPackages.view.focus}}

### `workbench.panel.positronConsole.focus`

Focuses the Console pane. Use when the user wants to run code interactively,
type at the prompt, or review console output/history directly.

**Arguments:** {{args:workbench.panel.positronConsole.focus}}

**Returns:** {{returns:workbench.panel.positronConsole.focus}}

### `positronVariables.focus`

Focuses the Variables pane. Use when the user wants to inspect current
values/objects in the active session.

**Arguments:** {{args:positronVariables.focus}}

**Returns:** {{returns:positronVariables.focus}}

### `workbench.panel.positronHelp.focus`

Focuses the Help pane. Use when the user wants to view rendered
documentation -- often right after a help lookup (see
`positron.help.lookupHelpTopic` in [troubleshooting.md](troubleshooting.md))
so they can see the result.

**Arguments:** {{args:workbench.panel.positronHelp.focus}}

**Returns:** {{returns:workbench.panel.positronHelp.focus}}

### `workbench.panel.positronPlots.focus`

Focuses the Plots pane. Use when the user wants to see a chart or plot that
was just generated, or asks to switch to the plots view.

**Arguments:** {{args:workbench.panel.positronPlots.focus}}

**Returns:** {{returns:workbench.panel.positronPlots.focus}}

## Console and Data Explorer view state

### `workbench.action.positronConsole.clearConsole`

Clears all output from the active Console pane. Use when the user asks to
clear, wipe, or get a clean console before rerunning something. No precondition
is set at the command level (there is a keybinding `when` clause, but it gates
the keybinding, not the command itself) -- always enabled.

**Arguments:** {{args:workbench.action.positronConsole.clearConsole}}

**Returns:** {{returns:workbench.action.positronConsole.clearConsole}}

### `workbench.action.positronDataExplorer.collapseSummary`

Collapses the column summary panel in the active Data Explorer. Use when the
user wants more room for the data grid itself and doesn't need per-column
stats visible.

Precondition: requires a Data Explorer editor to be the active editor.

**Arguments:** {{args:workbench.action.positronDataExplorer.collapseSummary}}

**Returns:** {{returns:workbench.action.positronDataExplorer.collapseSummary}}

### `workbench.action.positronDataExplorer.expandSummary`

Expands the column summary panel in the active Data Explorer. Use when the
user wants to see per-column statistics/histograms again.

Precondition: requires a Data Explorer editor to be the active editor.

**Arguments:** {{args:workbench.action.positronDataExplorer.expandSummary}}

**Returns:** {{returns:workbench.action.positronDataExplorer.expandSummary}}
