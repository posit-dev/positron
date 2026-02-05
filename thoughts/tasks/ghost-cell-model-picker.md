# Task: Ghost Cell Model Picker

**Status:** in-progress
**Last Updated:** 2026-02-04
**Branch:** positron-nb-ghost-suggestions

## Context for Claude

When working with this task, keep this file updated:
- **Current State**: Update when features/components are completed
- **Decisions Made**: Add when you choose between approaches (include why)
- **Key Files**: Add files you discover that are central but weren't listed
- **Gap detection**: If you had to look something up that should have been documented here, add it immediately

Keep updates concise--bullet points, not paragraphs.

## Overview

Add a settings-based model picker for ghost cell suggestions, allowing users to configure which LLM model generates next-cell suggestions in notebooks.

## Key Files

- `src/vs/workbench/contrib/positronNotebook/common/positronNotebookConfig.ts` - Settings definitions (where new model setting will live)
- `extensions/positron-assistant/src/ghostCellSuggestions.ts` - Where model selection will be consumed
- `extensions/positron-assistant/src/notebookAssistantMetadata.ts` - Extension-side settings resolution
- `src/vs/workbench/contrib/positronNotebook/common/notebookAssistantMetadata.ts` - Workbench-side metadata

## Decisions Made

- **New dedicated setting**: Create a ghost-cell-specific model setting rather than reusing existing infrastructure (gives more control over model selection for this specific feature)

## Current State

**Done:**
- Ghost cell streaming infrastructure complete (see `ghost-cell-streaming.md`)
- Opt-in flow and pull mode implemented

**Next:**
- Explore how models are currently selected/configured in the assistant extension
- Design the settings schema for model selection
- Implement the setting in positronNotebookConfig.ts
- Wire up model selection in ghostCellSuggestions.ts

## Related Docs

- `thoughts/tasks/ghost-cell-streaming.md` - Parent feature context

## Notes

- Need to understand what model options are available and how they're enumerated
- Consider whether to support per-notebook model override (like suggestionMode)
- May need to coordinate with Copilot/assistant infrastructure for model discovery
