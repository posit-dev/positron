---
date: 2026-01-27
author: Claude Code
branch: positron-nb-native-diff-view-toggle
repository: positron
topic: "Notebook-Specific AI Settings Architecture"
tags: [architecture, notebooks, metadata, assistant, settings]
status: complete
---

# Notebook-Specific AI Settings Architecture Report

This document explains how Positron stores and manages notebook-specific AI assistant settings. The initial implementation supports a single setting (`showDiff`), but the architecture is designed to support future settings and even notebook-specific prompts.

## Executive Summary

Notebook-specific settings are stored in the notebook file's metadata at `metadata.positron.assistant.*`. This approach:

- **Persists with the notebook file** - settings travel with the `.ipynb` file
- **Is format-agnostic** - the same pattern works for any notebook format
- **Has minimal dirty-state impact** - changes mark the document dirty (by design)
- **Supports progressive enhancement** - new settings can be added without migration

## Architecture Overview

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              .ipynb File                                     │
│  {                                                                           │
│    "metadata": {                                                             │
│      "positron": {                                                           │
│        "assistant": {                                                        │
│          "showDiff": "showDiff" | "noDiff"    ← Stored here                 │
│        }                                                                     │
│      }                                                                       │
│    },                                                                        │
│    "cells": [...]                                                            │
│  }                                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ipynb Extension                                      │
│  deserializers.ts: Loads metadata into NotebookData                         │
│  serializers.ts: Preserves all metadata fields on save                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        NotebookTextModel                                     │
│  metadata: Record<string, unknown>  ← In-memory storage                     │
│  applyEdits([{ editType: CellEditType.DocumentMetadata, ... }])             │
└─────────────────────────────────────────────────────────────────────────────┘
                           │                    │
                           ▼                    ▼
            ┌──────────────────────┐  ┌──────────────────────────┐
            │   AssistantPanel.tsx │  │     notebookTools.ts     │
            │   (Workbench - UI)   │  │   (Extension - Runtime)  │
            │   Reads & writes     │  │   Reads only             │
            └──────────────────────┘  └──────────────────────────┘
```

### Key Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| **Schema Definition** | `AssistantPanel.tsx:62-90` | **AUTHORITATIVE** - defines the metadata structure |
| **UI Controls** | `AssistantPanel.tsx:227-320` | Toggle UI for user to change settings |
| **Metadata Read/Write** | `AssistantPanel.tsx:324-381` | Helper functions for workbench access |
| **Extension Reader** | `notebookTools.ts:24-40` | Runtime resolution in positron-assistant |
| **Global Setting** | `positronNotebookConfig.ts` | Fallback when notebook has no override |

### Metadata Schema

```typescript
// notebook.metadata structure
{
  "positron": {
    "assistant": {
      "showDiff": "showDiff" | "noDiff"  // Per-notebook override
      // Future: contextScope, planningGoal, customPrompt, etc.
    }
  }
}
```

**Design Decisions:**

1. **String values over booleans** - Uses `'showDiff' | 'noDiff'` rather than `true | false` to:
   - Distinguish "not set" (`undefined`) from explicit values
   - Allow future multi-state options without schema changes
   - Self-document the meaning in raw JSON

2. **Nested namespace** - `positron.assistant.*` provides:
   - Clear ownership (Positron-specific)
   - Room for other Positron features alongside assistant settings
   - Collision avoidance with other notebook metadata

3. **Three-state UI** - The UI offers "follow global | yes | no":
   - `undefined` = inherit from global VS Code setting
   - `'showDiff'` = always show diffs for this notebook
   - `'noDiff'` = never show diffs for this notebook

## Setting Resolution

Both the workbench and extension read settings identically:

```typescript
// 1. Check notebook metadata first
const positron = notebook.metadata?.positron;
const assistant = positron?.assistant;
const override = assistant?.showDiff;

// 2. If set, use it
if (override !== undefined) {
  return override === 'showDiff';
}

// 3. Fall back to global VS Code setting
return vscode.workspace.getConfiguration()
  .get('positron.assistant.notebook.showDiff', true);
```

## Tradeoffs

### Strengths

1. **Persistence** - Settings save with the notebook file, so they're preserved across sessions and when sharing files

2. **Visibility** - Settings are visible in the raw `.ipynb` JSON, making debugging straightforward

3. **Zero Migration** - Old notebooks work fine (use global setting), new notebooks can opt into overrides

4. **Format Agnostic** - The `NotebookSerializer` interface means any notebook format (`.ipynb`, future `.qmd`, etc.) could support this pattern

5. **Undo/Redo** - Uses `NotebookTextModel.applyEdits()`, so setting changes participate in the standard undo stack

### Rough Edges

1. **Dirty State on Toggle** - Changing the setting marks the notebook dirty. This is intentional (the user is changing the file) but may surprise users who just want to toggle a view preference.

2. **No Transient Option** - The ipynb extension's `transientDocumentMetadata` config doesn't exclude `positron.assistant.*`, so these changes always trigger dirty state. This could be changed, but then settings wouldn't persist.

3. **Schema Duplication** - The schema is defined in `AssistantPanel.tsx` with a comment pointing to it, but `notebookTools.ts` has its own copy of the type. A shared types file would be cleaner but adds complexity.

4. **Type Casting** - Both readers use `as Record<string, unknown>` casts because `NotebookDocumentMetadata` is `Record<string, unknown>`. This is safe but verbose.

5. **Pending Diffs Dialog** - When toggling showDiff with pending edits, users see a confirmation dialog. The UX works but adds friction. An alternative would be to auto-accept/reject based on the direction of toggle.

6. **No Bulk Reset** - There's no UI to "reset all notebook-specific settings to global defaults" - users must toggle each one individually.

7. **Discovery** - Settings are only accessible via the Assistant Panel modal, not via the command palette or right-click menus.

## Future Extensions

### Adding New Settings

To add a new notebook-specific setting:

1. **Update the schema** in `AssistantPanel.tsx` (lines 81-86):
   ```typescript
   // metadata.positron.assistant: {
   //   showDiff?: 'showDiff' | 'noDiff'
   //   contextScope?: 'all' | 'selected' | 'none'  // NEW
   // }
   ```

2. **Add getter function** similar to `getShowDiffOverrideFromNotebook()`

3. **Add setter function** similar to `updateShowDiffOverrideInNotebook()`

4. **Add UI controls** in the `ReadyState` component

5. **Add extension reader** in `notebookTools.ts` if needed at runtime

6. **Register global setting** in `positronNotebookConfig.ts` for the fallback

### Notebook-Specific Prompts (claude.md for notebooks)

The architecture naturally supports storing custom prompts:

```typescript
// Future schema extension
{
  "positron": {
    "assistant": {
      "showDiff": "showDiff",
      "systemPrompt": "Always use pandas for data manipulation...",
      "contextInstructions": "Focus on cells 1-5 only"
    }
  }
}
```

**Considerations:**

1. **Length limits** - Prompts could be large; may want to store a reference to a separate file instead

2. **UI** - Would need a text editor in the Assistant Panel, not just toggles

3. **Privacy** - Prompts stored in notebook files are visible to anyone with the file

4. **Versioning** - Prompt changes would be tracked in git, which could be good (history) or bad (noise)

### Potential Improvements

1. **Settings validation** - Could validate against a JSON schema on load

2. **Migration support** - If schema changes, could add version field and migration logic

3. **Shared types package** - Extract schema types to a shared location

4. **Command palette access** - Register commands for toggling settings without opening the panel

5. **Status bar indicator** - Show when notebook has custom settings

## Code References

| File | Line(s) | Purpose |
|------|---------|---------|
| `AssistantPanel.tsx` | 62-90 | Schema documentation (authoritative) |
| `AssistantPanel.tsx` | 96 | `ShowDiffOverride` type |
| `AssistantPanel.tsx` | 324-330 | `getShowDiffOverrideFromNotebook()` |
| `AssistantPanel.tsx` | 335-381 | `updateShowDiffOverrideInNotebook()` |
| `AssistantPanel.tsx` | 227-320 | UI controls in `ReadyState` |
| `notebookTools.ts` | 24-40 | `resolveShowDiffSetting()` |
| `notebookTools.ts` | 488-492 | Usage in EditNotebookCells tool |
| `positronNotebookConfig.ts` | 78-86 | Global setting registration |
| `ipynbMain.ts` | 43-46 | Transient metadata config |

## Conclusion

The notebook metadata approach provides a solid foundation for notebook-specific settings. The main tradeoff is dirty-state behavior (settings changes require saving), which is acceptable for persistent preferences. For purely session-based preferences, a different storage mechanism (like VS Code's memento system) would be more appropriate.

The architecture is well-suited for expansion to additional settings, including potentially notebook-specific system prompts. The main work for future settings is UI design rather than infrastructure.
