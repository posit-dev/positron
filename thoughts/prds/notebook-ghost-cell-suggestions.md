# PRD: Notebook Ghost Cell Suggestions

**Status:** Complete - Ready for Implementation
**Created:** 2026-01-30
**Updated:** 2026-01-30

## Problem Statement

Data scientists experience "analysis paralysis" when working in notebooks. After executing a cell, they often face a blank cell and must decide what to do next. The cognitive overhead of thinking "how do I do X?" can prevent them from ever starting, breaking their analytical flow state.

This isn't an acute pain—users work around it—but it represents friction in the exploratory analysis workflow that compounds over time.

## Target Users

Data scientists doing exploratory analysis in Python or R notebooks. These users:
- Work iteratively, executing cells and deciding next steps on the fly
- May know *what* they want to do but not immediately recall *how*
- Value maintaining flow state during analysis sessions

## Current Alternatives

Users currently:
- Stare at the blank cell, trying to recall the right approach or API
- Experience startup cost that delays or blocks analysis entirely
- Context-switch to documentation or previous notebooks for reference

Existing AI tools (Copilot, etc.) offer inline completion but:
- Require the user to start typing first
- Don't understand the analytical narrative across cells
- Lack Positron-specific context (variables panel, data explorer, runtime state)

## Proposed Solution

A **ghost cell** that appears at the bottom of the notebook after cell execution, suggesting a likely next step.

### Core Experience
- After a user executes a cell, a ghost cell appears below it
- The ghost cell contains:
  - Suggested code for a plausible next analytical step
  - A brief explanatory comment describing what the suggestion does and why
- The ghost cell is visually distinct (grayed out with dashed border)
- User can:
  - **Accept**: Convert ghost cell to real cell and execute (Tab, Enter, or click)
  - **Dismiss**: Remove the suggestion (Esc or click dismiss)
  - **Ignore**: Continue working; ghost cell disappears when user creates a new cell

### Loading State
- Ghost cell appears after 3-second debounce with a loading indicator (spinner/skeleton)
- If user executes another cell during debounce, timer resets (no flickering during rapid iteration)
- Content streams in as the LLM generates the suggestion
- Signals "suggestion coming" without blocking the user

### Context Awareness
The suggestion should be informed by:
- The code and output of recent cells
- The analytical narrative (e.g., loaded data → cleaned data → visualize)
- Available variables and their types (leveraging Positron's variables panel)
- Common data science patterns for the detected workflow

### Example Flow
1. User loads a CSV with pandas: `df = pd.read_csv('sales.csv')`
2. Ghost cell appears with loading state, then: `# Preview the data structure and check for missing values`
   `df.info()`
3. User accepts, executes
4. New ghost cell: `# Visualize the distribution of the target variable`
   `df['revenue'].hist()`

## Success Criteria

1. **Feature retention**: Users who try ghost cells keep them enabled (don't disable in settings)
2. **Qualitative feedback**: Positive sentiment in user feedback, GitHub discussions, social media
3. **Strategic positioning**: Feature is cited as a differentiator when users discuss Positron vs. alternatives

## Non-Goals

The initial version explicitly excludes:

- **Multi-cell suggestions**: Only one cell at a time; no suggesting sequences of 2+ cells
- **Inline completion integration**: This is a separate interaction model from Copilot-style completion; they don't need to interact
- **Real-time updates**: Ghost cell appears after execution, not while typing
- **Mandatory usage**: Feature should be easily dismissable and disableable

---

## Technical Decisions (Resolved)

### 1. LLM Backend
**Decision:** Use existing multi-provider infrastructure

Reuse the `model.sendRequest()` pattern from `notebookSuggestions.ts`. The existing system supports:
- Cloud providers (OpenAI, Anthropic, Azure, Google, etc.)
- Local (Ollama)
- VS Code Copilot integration

No new infrastructure needed—provider selection follows user configuration and environment variables.

### 2. Latency Handling
**Decision:** Show loading placeholder after debounce

Ghost cell appears after 3-second debounce with spinner/skeleton state. Content streams in as generated. This prevents flickering during rapid iteration while still signaling "suggestion coming."

**Implementation note:** Can adapt the existing `PendingState` component pattern from Assistant Panel.

### 3. Settings Surface
**Decision:** Global setting + per-notebook override

Follow the existing pattern for `showDiff` and `autoFollow`:
- Global VS Code setting: `positron.notebooks.ghostCellSuggestions.enabled` (default: true)
- Per-notebook override in `metadata.positron.assistant.ghostCellSuggestions`: `'enabled' | 'disabled' | undefined`
- Toggle accessible in Assistant Panel settings section

### 4. Visual Design
**Decision:** Grayed out cell with dashed border

The ghost cell renders like a real cell but with:
- Reduced opacity / grayed out content
- Dashed border instead of solid
- Clear "Accept" and "Dismiss" affordances
- Loading skeleton state before content arrives

**Implementation note:** Extend `NotebookCellWrapper` with `isGhost` prop for appropriate CSS classes.

### 5. Context / Prompt Engineering
**Decision:** Reuse existing notebook context system

Use `filterNotebookContext()` from `notebookContextFilter.ts`:
- Small notebooks (<20 cells): All cells included
- Large notebooks: Sliding window of 10 cells before/after the executed cell
- Content budget: 50k chars total, non-selected cells truncated to 2k chars
- Includes: kernel language, execution status, outputs

This ensures consistency with other AI features and handles large notebooks gracefully.

### 6. Language Support
**Decision:** Python and R from day one

The kernel language is already included in notebook context (`context.kernelLanguage`). The prompt can adapt suggestions based on language. No extra work required to support both.

### 7. Error Handling
**Decision:** Brief error indicator that auto-dismisses

On failure (timeout, API error, network issue):
- Show subtle "Suggestion unavailable" message in ghost cell area
- Auto-dismiss after 2-3 seconds
- No retry button or error details (this is a "nice-to-have" feature, not critical)

---

## Implementation Notes

### Key Files to Modify/Create

| Component | Location | Changes |
|-----------|----------|---------|
| Ghost cell component | `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/GhostCell.tsx` | New component |
| Notebook component | `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookComponent.tsx` | Render ghost cell after last cell |
| Cell wrapper styles | `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookCellWrapper.tsx` | Ghost styling classes |
| Suggestion generation | `extensions/positron-assistant/src/ghostCellSuggestions.ts` | New file, based on `notebookSuggestions.ts` |
| Settings metadata | `src/vs/workbench/contrib/positronNotebook/common/notebookAssistantMetadata.ts` | Add `ghostCellSuggestions` field |
| Notebook instance | `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts` | Trigger suggestion on cell execution |

### Existing Infrastructure to Leverage

- `notebookContextFilter.ts` - Context filtering and windowing
- `notebookUtils.ts` - `serializeNotebookContext()`, `hasAttachedNotebookContext()`
- `notebookSuggestions.ts` - Pattern for streaming LLM responses and parsing suggestions
- `participants.ts` - `attachContextInfo()` pattern for context attachment
- `promptRender.ts` - Template system for prompt files

### Prompt File Location

Create: `extensions/positron-assistant/markdown/prompts/notebook/ghost-cell.md`

Suggested prompt structure:
```markdown
---
mode: ask
---
You are suggesting a single next cell for a data science notebook.

Context:
- Kernel language: {{kernelLanguage}}
- Just executed cell and its output are provided below
- Available variables and recent cell history are included

Generate a single code cell that would be a logical next step. Respond in this exact XML format:

<suggestion>
  <explanation>Brief description of what this does and why (1-2 sentences)</explanation>
  <code>
# Comment explaining the suggestion
your_code_here()
  </code>
</suggestion>

Keep suggestions:
- Actionable (something the user can run immediately)
- Contextual (based on what they just did)
- Concise (under 20 lines, one focused operation)
```

### Interaction Model
**Decision:** Ghost cell is selectable like a normal cell

The ghost cell does NOT hijack focus or introduce special keyboard shortcuts. Instead:
- Ghost cell appears after the last cell, visually distinct but selectable
- User can select it like any other cell (click or arrow navigation)
- When selected, the cell reveals **Accept** and **Reject** buttons
- Buttons are tab-navigable for keyboard users
- This avoids conflicts with existing shortcuts and reduces learning curve

### Multiple Suggestions
**Decision:** Single suggestion with regenerate button

MVP shows one suggestion at a time. A **Regenerate** button allows fetching a new suggestion:
- When regenerating, include context about the rejected suggestion in the prompt
- This helps the model suggest something different
- Architecture should support multiple suggestions in future iterations (e.g., cycling through alternatives)

### Telemetry
**Decision:** No telemetry

Privacy-friendly approach:
- No tracking of acceptance/rejection rates
- Rely on qualitative feedback and feature retention signals
- Consistent with Positron's privacy-respecting philosophy

---

## Detailed Specifications

### Trigger Rules

**When suggestions are requested:**
- Trigger on **successful cell execution only** - errors need fixing first, not next steps
- For batch operations (Run All, Run Above, multi-select): anchor suggestion to the **last successfully executed cell**
- If a new execution occurs while a suggestion is streaming: **cancel and replace** the in-flight request

**When suggestions are NOT triggered:**
- Cell execution ends in error or cancellation
- No model is configured
- Ghost cells are disabled (globally or per-notebook)

### Placement Rules

**Location:** Always at the **bottom of the notebook**, regardless of which cell was executed.

The suggestion content references the last executed cell's context, but the ghost cell itself is always appended after the final cell. This provides:
- Predictable, consistent location
- Clear mental model: "suggestion for what comes next"
- No UI jumping when executing cells in the middle

### Lifecycle Rules

**Accept:**
- Default: Insert as real cell (does not execute)
- With Shift modifier: Insert and execute immediately
- Standard undo removes the inserted cell (ghost does not return)

**Dismiss:**
- Default: Hide ghost until next cell execution
- With Shift modifier: Disable ghost cells for this notebook (saved in metadata)

**Ignore (implicit dismiss):**
- Ghost disappears when user creates a new cell (insert above/below, split, paste)
- Ghost persists through: editing other cells, typing elsewhere, scrolling
- Ghost is replaced when another cell is executed

### Implementation Model

**Approach:** Follow the **deletion sentinel pattern** - UI-only component, not part of the notebook model.

- Ghost cell is a React component rendered after the last cell
- Not included in notebook model (no dirty state, no save implications)
- Keyboard navigation includes ghost cell as a selectable item
- On accept: create a real cell via notebook API, then remove ghost

### Response Contract

**Output format:** Structured XML for reliable parsing

```xml
<suggestion>
  <explanation>Brief description of what this does and why</explanation>
  <code>
# Comment explaining the suggestion
actual_code_here()
  </code>
</suggestion>
```

**Parsing rules:**
- Extract `<explanation>` for display above/beside the code
- Extract `<code>` content as the cell content
- If parsing fails, treat entire response as code (fallback)

**Length limits:**
- Soft limit via prompt: instruct model to keep suggestions under ~20 lines
- No hard truncation - let model decide based on context

### Data Handling / Privacy

**Context sent to providers:**
- Follow existing assistant context patterns (`filterNotebookContext()`, `serializeNotebookContext()`)
- Variable names and types/shapes (e.g., `df: DataFrame[1000x5]`)
- Cell content subject to existing truncation rules (50k char budget, 2k per non-selected cell)
- Kernel language identifier

**Not sent:**
- Actual data values/samples (unless already in existing assistant context rules)
- No additional data beyond what other assistant features send

### Rate Limiting + Cancellation

**Cancellation:** New execution cancels any in-flight suggestion request (cancel-and-replace).

**Debounce:** 3-second delay before triggering suggestion.
- After cell execution completes, wait 3 seconds before showing ghost cell or sending LLM request
- If another execution occurs during the wait, reset the timer
- This prevents spam during iterative debugging (repeatedly running same cell)
- Ghost cell (with loading state) only appears after debounce settles - no flickering during rapid execution

**Timeout:** 30 seconds for suggestion generation. On timeout:
- Show "Suggestion unavailable" message
- Auto-dismiss after 2-3 seconds

### Regenerate Behavior

**UI placement:** Always visible alongside Accept and Dismiss buttons in the ghost cell action bar.

**Behavior:**
- Include the rejected suggestion in the regenerate prompt context
- No limit on regeneration count (user's API quota)
- Regenerate cancels any in-flight request (like a new execution would)

### Error Handling

**On failure (timeout, API error, network issue):**
- Show subtle "Suggestion unavailable" message in ghost cell area
- Auto-dismiss after 2-3 seconds
- Log errors to "Positron Assistant" output channel (no telemetry)

**Error logging:** Errors logged locally to output channel for debugging, consistent with existing assistant error handling.

### Kernel Support

**Approach:** Attempt suggestions for **any kernel language** - not limited to Python/R.

The kernel language is included in context, and the LLM can adapt suggestions accordingly. This allows the feature to work with Julia, SQL, and other languages supported by Jupyter kernels.

### Accessibility Requirements

**Keyboard navigation:**
- Ghost cell is selectable via arrow keys like any other cell
- When selected, Accept/Dismiss/Regenerate buttons are tab-navigable
- All actions accessible without mouse

**Screen reader:**
- Live region announces "Suggestion available" when content loads
- Full content readable when ghost cell is focused

**Visual preferences:**
- Loading state respects `prefers-reduced-motion` (static indicator instead of spinner)
- High contrast mode compatible
- Uses existing Positron theme variables for colors
