# Ghost Cell PR #11622 Feedback

Feedback from **seeM** on the ghost cell suggestions feature.

## Critical (Blocking)

- [x] **#1** Add setting to re-enable per-notebook opt-out
  - Users who click "Don't suggest in this notebook again" have no way to re-enable
  - Add a user-facing setting to control per-notebook opt-out
  - **Done:** Added command palette command + notification with Re-enable button

- [x] **#2** Fix bug: suggestion disappears after clicking Enable
  - "Generating suggestions..." appears briefly then disappears on first enable
  - **Done:** Added `skipConfigCheck` parameter to bypass extension-side config check when workbench has already verified (race condition fix)

## Settings/Behavior

- [x] **#8** Don't write default settings to settings.json
  - These settings appear without user explicitly changing them:
    - `positron.assistant.notebook.ghostCellSuggestions.hasOptedIn`
    - `positron.assistant.notebook.ghostCellSuggestions.mode`
    - `positron.assistant.notebook.ghostCellSuggestions.enabled`
  - Only write when user changes from default
  - **Done:** Removed `hasOptedIn` setting entirely. Now use `inspect()` to detect if user has explicitly set `enabled`. Renamed `mode` to `automatic` (boolean). Use `undefined` to remove settings matching defaults.

## UI Styling (Toggle)

- [x] **#3** Match Automatic/On-demand toggle to existing Positron patterns
  - Visual state confusion (hard to tell which is selected)
  - No hover style
  - Color inconsistency (blue vs gray/white elsewhere)
  - Double-clicking selects text (shouldn't)
  - **Done:** Updated to match ActionBarToggle pattern (sizing, hover effect, user-select: none)

## UI Layout

- [x] **#4** Move About button to right side
  - Left side is valuable real estate; About is infrequently used
  - **Done:** Moved info button to footer alongside model indicator

- [x] **#5** Add collapse/expand for truncated description text
  - Tooltip is uncomfortable for reading medium-sized descriptions
  - **Done:** Added "Show more"/"Show less" button when explanation is truncated

- [x] **#6** Remove sparkles icon from ghost cell
  - Dashed border already distinguishes the suggestion cell
  - **Done:** Removed sparkle icons from opt-in prompt, awaiting-request, and content header

- [x] **#7** Streamline on-demand mode UI to single line
  - Remove "AI suggestion available on request" text
  - Move buttons next to toggle for compact layout
  - **Done:** Simplified to single row: text, buttons, spacer, toggle, info button

## UI Polish

- [x] **#9** Change About button cursor from question mark to pointer
  - **Done:** Changed `cursor: help` to `cursor: pointer` for info button (fallback warning keeps `help` since it's tooltip-only)

- [x] **#10** Fix blue borders on Dismiss/Regenerate buttons
  - Match existing button styling in notebook/Positron
  - **Done:** Split hover/focus styles, use `:focus-visible` pattern to only show outline on keyboard navigation

- [ ] **#11** Remove vertical black line from ghost cell
  - Skipped: No explicit vertical line found in CSS

- [x] **#12** Remove animation when switching editors and back
  - **Done:** Removed `ghost-cell-fade-in` animation and keyframes

- [x] **#13** Make hover transition instant (match notebook pattern)
  - Current delay differs from other notebook transitions
  - **Done:** Changed transitions from 200ms to 0.1s to match AssistantPanel pattern

## Cleanup

- [x] **#14** Check if .gitignore line 50 is still needed
  - **Done:** No action needed - file ends at line 49, no ghost cell related entries

---

## Deferred to Follow-up PRs

- Notebook extension pattern refactor (`IPositronNotebookInstance.ts:464`)
- Moving context keys into notebook extensions (`ContextKeysManager.ts:28`)
- Keyboard navigation for ghost cells (Shift+Enter to accept)
- Syntax highlighting in suggestions

---

## Positive Feedback

- Inline prompt UI is great
- Prompt instructions in `ghost-cell.md` were followed well
- Immediate followup suggestion after accepting was "super satisfying"
