---
title: Add "experimental" tag to all notebook AI/ghost cell settings
labels: area: notebooks, notebooks-ai, enhancement, theme: new notebook frontend
repository: posit-dev/positron
---

The notebook AI/ghost cell settings should be tagged as experimental to set user expectations
that this feature is still under active development.

## Status

**Complete** -- Implemented on branch `nick/ghost-cell-experimental-labels` (commit `e49517fdd1`).

All 5 ghost cell settings in `config.ts` now have `tags: ['experimental']`, which surfaces
the "Experimental" badge in the Settings UI next to each setting.

## Settings updated

All settings live in `src/vs/workbench/contrib/positronNotebook/browser/contrib/ghostCell/config.ts`:

1. `positron.assistant.notebook.ghostCellSuggestions.enabled`
2. `positron.assistant.notebook.ghostCellSuggestions.delay`
3. `positron.assistant.notebook.ghostCellSuggestions.automatic`
4. `positron.assistant.notebook.ghostCellSuggestions.model`
5. `positron.assistant.notebook.ghostCellSuggestions.maxVariables`

## Context

Similar to how the new notebook frontend was gated behind an experimental setting (#8600),
the ghost cell feature settings should clearly communicate their experimental status.
