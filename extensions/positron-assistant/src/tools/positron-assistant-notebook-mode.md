# Positron Assistant Notebook Mode

## Detection

Notebook mode is enabled when **both** conditions are met:
1. A notebook file (`.ipynb`) is attached as context to the chat request
2. That notebook has an active Positron notebook editor open

The assistant uses a helper function to check these conditions:

```typescript
const notebookContext = await getAttachedNotebookContext(request);
```

**Location:** `extensions/positron-assistant/src/participants.ts:759`

This function:
1. Calls `positron.notebooks.getContext()` to get the active notebook editor
2. Extracts all `.ipynb` file URIs from `request.references` (attached context)
3. Checks if the active notebook's URI matches any attached notebook
4. Returns `NotebookContext` if there's a match, `undefined` otherwise

**Key behavior:** Users must explicitly attach a notebook file to enable notebook mode, even if a notebook is the active editor. This prevents unintended notebook mode activation.

## Context Information

When a notebook is active, `NotebookContext` provides:

- `uri` - Notebook file path
- `kernelId` / `kernelLanguage` - Active kernel info
- `cellCount` - Total number of cells
- `selectedCells[]` - Currently selected cells with:
  - `id` - Unique cell identifier
  - `index` - Cell position (0-based)
  - `type` - 'code' or 'markdown'
  - `content` - Cell source code
  - `hasOutput` - Whether cell has output
  - `selectionStatus` - Selection status ('unselected' | 'selected' | 'active'). Note: 'active' represents cells in editing mode
  - `executionStatus` - **Code cells only**: Execution status ('running' | 'pending' | 'idle')
  - `executionOrder` - **Code cells only**: Execution order number from last run
  - `lastRunSuccess` - **Code cells only**: Whether last execution succeeded
  - `lastExecutionDuration` - **Code cells only**: Duration of last execution in milliseconds
  - `lastRunEndTime` - **Code cells only**: Timestamp when last execution ended
- `allCells[]` - **Optional**: All cells in the notebook (same structure as `selectedCells`). Only included if the notebook has fewer than 20 cells to avoid consuming too much context space.

**Context Construction Location:** `src/vs/workbench/api/browser/positron/mainThreadNotebookFeatures.ts:46`

The context is assembled by:
1. Getting the active notebook instance from the editor
2. Reading current state from observables (cells, kernel, selection)
3. Converting selected cells to DTOs (always included) with status information:
   - Selection status from `cell.selectionStatus` (maps 'editing' to 'active')
   - Execution status fields from code cell observables (only for code cells)
4. Converting all cells to DTOs only if `cellCount < MAX_CELLS_FOR_ALL_CELLS_CONTEXT` (currently 20)

## Impact on Chat Behavior

### System Prompt Augmentation
**Locations:** `participants.ts:859` (Chat/Ask), `participants.ts:884` (Edit), `participants.ts:906` (Agent)

When notebook mode is enabled (attached context + active editor), the assistant's system prompt is augmented with:

1. **Notebook metadata** - URI, kernel, cell count, selected cells
2. **Cell details** - IDs, content, status information (selection status, execution status, execution order, run success/failure, duration) for selected cells (and all cells if notebook is small enough)
3. **Usage instructions**:
   - Focus on selected cells when analyzing/explaining
   - Use cell IDs when referencing specific cells
   - Pay attention to cell status information (selection status, execution status, execution order, run success/failure)
   - Consider execution order and cell dependencies
   - Maintain notebook structure with markdown cells
   - Use notebook-specific tools for manipulation

### Tool Availability
**Location:** `api.ts:177`

```typescript
const notebookContext = await getAttachedNotebookContext(request);
const hasActiveNotebook = !!notebookContext;
```

The `hasActiveNotebook` flag determines which tools are available. Tools tagged with `'requires-notebook'` are only enabled when notebook mode is active (notebook attached as context AND has active editor).

### Behavioral Changes

**Without notebook mode (no attached notebook OR notebook not active editor):**
- General coding assistant
- Standard file/editor operations
- No notebook-specific tools available

**With notebook mode (notebook attached as context AND has active editor):**
- Notebook-aware assistant
- Access to notebook-specific tools:
  - `GetNotebookCells` - Read cell contents with status information (selection status, execution status, execution order, run success/failure, duration)
  - `RunNotebookCells` - Execute cells
  - `AddNotebookCell` - Create new cells
  - `UpdateNotebookCell` - Modify cell content
  - `GetCellOutputs` - Retrieve cell outputs
- References cells by ID in responses
- Suggests cell-based operations
- System prompt includes selected cell content, metadata, and status information
- For small notebooks (< 20 cells), system prompt also includes all cell content and status via `allCells` field

## Tool Implementation

All notebook tools check for active notebook and return error if none found:

```typescript
const context = await positron.notebooks.getContext();
if (!context) {
    return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart('No active notebook found')
    ]);
}
```

**Location:** `extensions/positron-assistant/src/tools/notebookTools.ts`

### Cell Status Information

The `GetNotebookCells` tool returns cells with complete status information:
- **Selection status**: 'unselected' | 'selected' | 'active' (where 'active' indicates editing mode)
- **Execution status**: 'running' | 'pending' | 'idle' (code cells only)
- **Execution order**: Number indicating execution sequence (code cells only)
- **Last run success**: Boolean indicating if last execution succeeded (code cells only)
- **Execution duration**: Duration in milliseconds (code cells only)
- **Output status**: Whether the cell has output

This status information helps the assistant understand:
- Which cells are currently selected or being edited
- Which cells are executing or queued for execution
- The execution history and success/failure of previous runs
- The execution order to understand dependencies

## API Definition

**Location:** `src/positron-dts/positron.d.ts:2331-2474`

Full API namespace: `positron.notebooks`


## Implementation Approach

The current implementation uses **attached context detection** without API changes:

### What Was Implemented
✅ Check attached context for notebook files (`.ipynb`)
✅ Verify that attached notebook has an active editor
✅ Enable notebook mode only when both conditions are met
✅ Keep all logic in extension layer (no core API changes)

### Alternative Approaches (Not Implemented)

**1. API-based URI checking:**
- Add `positron.notebooks.getContext(uri?: Uri)` parameter
- Add `positron.notebooks.hasEditorForUri(uri: Uri): boolean` method
- **Trade-off:** More implementation complexity, cross-layer changes

**2. Separate "Notebook" mode:**
- New mode alongside Ask/Edit/Agent modes
- **Trade-off:** UI changes, more modes to maintain

**3. Template-based prompt injection:**
- Move notebook instructions to `promptRender.ts` templating system
- **Trade-off:** Would require refactoring existing prompt system

The chosen approach (attached context detection) provides the cleanest implementation with minimal complexity and no API surface changes.

## Testing Scenarios

### Expected Behavior

| Scenario | Notebook Attached? | Notebook Active Editor? | Notebook Mode? |
|----------|-------------------|------------------------|----------------|
| 1 | ✅ Yes | ✅ Yes (same file) | ✅ ON |
| 2 | ✅ Yes | ❌ No (different file active) | ❌ OFF |
| 3 | ❌ No | ✅ Yes | ❌ OFF |
| 4 | ✅ Multiple notebooks | ✅ Yes (one is active) | ✅ ON |
| 5 | ✅ Multiple notebooks | ❌ No (none active) | ❌ OFF |

### How to Test

1. **Attach notebook file** using `@filename.ipynb` in chat
2. **Open notebook** in Positron notebook editor
3. **Verify behavior**:
   - Notebook tools should appear in tool list
   - System prompt should include selected cell information with status (selection status, execution status, etc.)
   - Assistant responses should reference cell IDs
   - `GetNotebookCells` tool should return cells with complete status information

