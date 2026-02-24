# Positron Notebook

## Context Key Hierarchy

`POSITRON_NOTEBOOK_EDITOR_FOCUSED` (DOM focus within the notebook editor container) implies `activeEditor === 'workbench.editor.positronNotebook'`. The notebook container can only have DOM focus when the notebook is the active editor.

Do NOT redundantly check both. Use `POSITRON_NOTEBOOK_EDITOR_FOCUSED` alone. See `contrib/find/actions.ts` for the correct pattern.
