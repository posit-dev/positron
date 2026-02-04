# PRD: Ghost Cell Pull Mode

**Status:** Implemented
**Created:** 2026-02-02
**Updated:** 2026-02-02

## Problem Statement

Cost-conscious users (especially enterprise) want ghost cell suggestions but not the automatic token spend that comes with push-based suggestions. Currently, their only option is to disable ghost cells entirely, losing all value from the feature. This creates an all-or-nothing choice that causes a segment of users to avoid the feature or churn.

## Target Users

- **Primary:** Enterprise/cost-conscious users who want control over LLM token usage
- **Secondary:** Users who find automatic suggestions distracting but still want on-demand AI assistance

## Current Alternatives

Users disable ghost cell suggestions entirely via settings. This works to prevent unwanted token spend but means they get zero value from the feature - no suggestions at all, even when they would be helpful.

## Proposed Solution

Add a "pull-based" mode as an alternative to the current "push-based" (automatic) mode:

- **UI:** Show an empty ghost cell placeholder with a "Get Suggestion" button
- **Behavior:** No LLM call until user explicitly clicks the button
- **After request:** Streams suggestion into ghost cell (same as push mode once triggered)
- **Mode toggle:** Segmented toggle in ghost cell header (Automatic / On-demand)
- **Setting:** `positron.assistant.notebook.ghostCellSuggestions.mode` with values `push` or `pull`

### User Flow (Pull Mode)
1. User executes a cell successfully
2. Ghost cell placeholder appears after configured delay with "Get Suggestion" button
3. User clicks button (or uses Cmd/Ctrl+Shift+G) when ready for a suggestion
4. Loading state, then suggestion streams in
5. User accepts, dismisses, or requests a new suggestion

## Success Criteria

- Users report feeling more in control of AI usage (qualitative feedback)
- Secondary: Fewer users disable ghost cells entirely

## Non-Goals

- Token budgeting/spending limits - this is purely about trigger mechanism
- Different model selection per mode - uses same model as push mode
- Queuing multiple requests - one request at a time
- Smart trigger suggestions ("you might want a suggestion here") - purely manual

## Implementation Details

### Files Modified
- `IPositronNotebookInstance.ts` - Added `getSuggestionMode()` and `toggleSuggestionMode()` to interface
- `PositronNotebookInstance.ts` - Implemented mode toggle, added `awaiting-request` state handling
- `GhostCell.tsx` - Added `SuggestionModeToggle` component, `GhostCellAwaitingRequest` component
- `GhostCell.css` - Styled toggle to match AssistantPanel pattern
- `positronNotebookConfig.ts` - Added `POSITRON_NOTEBOOK_GHOST_CELL_MODE_KEY` setting
- `positronNotebook.contribution.ts` - Added keyboard shortcut for requesting suggestions

### UI Components
- **SuggestionModeToggle:** Segmented toggle with "Automatic" and "On-demand" options, styled consistently with AssistantPanel toggles
- **GhostCellAwaitingRequest:** Pull mode placeholder with sparkle icon, info button, mode toggle, "Get Suggestion" button, and "Dismiss" button

### State Machine
Added new ghost cell state: `awaiting-request`
- Shown after cell execution when mode is `pull`
- Transitions to `loading` when user requests suggestion
- Can be dismissed like other ghost cell states

## Resolved Questions

1. **Default mode:** Push mode remains the default (maintains existing behavior)
2. **Button label:** "Get Suggestion" - clear and action-oriented
3. **Keyboard shortcut:** Cmd/Ctrl+Shift+G triggers suggestion in pull mode
4. **Placeholder timing:** Appears after the same configurable delay as push mode suggestions

## Bugs to fix
- Clicking "accept" on enable popup should automatically generate a cell, not dismiss the popup until next run. (Not addressed in this PR)
