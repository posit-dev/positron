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

- [ ] **#8** Don't write default settings to settings.json
  - These settings appear without user explicitly changing them:
    - `positron.assistant.notebook.ghostCellSuggestions.hasOptedIn`
    - `positron.assistant.notebook.ghostCellSuggestions.mode`
    - `positron.assistant.notebook.ghostCellSuggestions.enabled`
  - Only write when user changes from default

## UI Styling (Toggle)

- [ ] **#3** Match Automatic/On-demand toggle to existing Positron patterns
  - Visual state confusion (hard to tell which is selected)
  - No hover style
  - Color inconsistency (blue vs gray/white elsewhere)
  - Double-clicking selects text (shouldn't)

## UI Layout

- [ ] **#4** Move About button to right side
  - Left side is valuable real estate; About is infrequently used

- [ ] **#5** Add collapse/expand for truncated description text
  - Tooltip is uncomfortable for reading medium-sized descriptions

- [ ] **#6** Remove sparkles icon from ghost cell
  - Dashed border already distinguishes the suggestion cell

- [ ] **#7** Streamline on-demand mode UI to single line
  - Remove "AI suggestion available on request" text
  - Move buttons next to toggle for compact layout

## UI Polish

- [ ] **#9** Change About button cursor from question mark to pointer

- [ ] **#10** Fix blue borders on Dismiss/Regenerate buttons
  - Match existing button styling in notebook/Positron

- [ ] **#11** Remove vertical black line from ghost cell

- [ ] **#12** Remove animation when switching editors and back

- [ ] **#13** Make hover transition instant (match notebook pattern)
  - Current delay differs from other notebook transitions

## Cleanup

- [ ] **#14** Check if .gitignore line 50 is still needed

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
