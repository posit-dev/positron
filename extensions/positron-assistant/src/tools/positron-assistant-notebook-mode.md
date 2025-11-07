# Positron Assistant Notebook Mode

## Detection

Notebook mode is enabled differently depending on the chat interface being used:

### Chat Pane Mode

Notebook mode is enabled when **both** conditions are met:
1. A notebook file (`.ipynb`) is attached as context to the chat request
2. That notebook has an active Positron notebook editor open

The assistant uses a helper function to check these conditions:

```typescript
const notebookContext = await getAttachedNotebookContext(request);
```

**Location:** `extensions/positron-assistant/src/participants.ts` (function `getAttachedNotebookContext`)

This function:
1. Calls `positron.notebooks.getContext()` to get the active notebook editor
2. Extracts all `.ipynb` file URIs from `request.references` (attached context)
3. Checks if the active notebook's URI matches any attached notebook
4. Returns `NotebookContext` if there's a match, `undefined` otherwise

**Key behavior:** Users must explicitly attach a notebook file to enable notebook mode, even if a notebook is the active editor. This prevents unintended notebook mode activation.

### Inline Cell Chat Mode

Notebook mode is automatically enabled when using inline chat within a Positron notebook cell. The inline chat controller detects Positron notebooks and routes requests to the notebook participant.

**Detection mechanism:**
1. When inline chat is triggered in a cell editor, the inline chat controller checks if the editor belongs to a Positron notebook
2. If yes, the chat location is set to `ChatAgentLocation.Notebook`
3. This routes the request to the `PositronAssistantNotebookParticipant`
4. The participant retrieves notebook context and provides cell-aware context

**Locations:**
- Route detection: `src/vs/workbench/contrib/inlineChat/browser/inlineChatController.ts` (function `updateLocationForPositronNotebooks`)
- Context generation: `extensions/positron-assistant/src/participants.ts` (class `PositronAssistantNotebookParticipant.getCustomPrompt`)


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

**Context Construction Location:** `src/vs/workbench/api/browser/positron/mainThreadNotebookFeatures.ts`

The context is assembled by:
1. Getting the active notebook instance from the editor
2. Reading current state from observables (cells, kernel, selection)
3. Converting selected cells to DTOs (always included) with status information:
   - Selection status from `cell.selectionStatus` (maps 'editing' to 'active')
   - Execution status fields from code cell observables (only for code cells)
4. Converting all cells to DTOs only if `cellCount < MAX_CELLS_FOR_ALL_CELLS_CONTEXT` (currently 20)

## Impact on Chat Behavior

### System Prompt Augmentation
**Locations:** `extensions/positron-assistant/src/participants.ts` (Chat/Ask, Edit, and Agent mode handlers)

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
**Locations:** `extensions/positron-assistant/src/api.ts` (function `getEnabledTools`)

```typescript
const notebookContext = await getAttachedNotebookContext(request);
const hasActiveNotebook = !!notebookContext;
```

The `hasActiveNotebook` flag determines which tools are available. Tools tagged with `'requires-notebook'` are only enabled when notebook mode is active (notebook attached as context AND has active editor).

**Mode-Based Tool Restrictions:**

Notebook tools are conditionally available based on the assistant mode:

**Modification Tools (Agent mode only):**
- `RunNotebookCells` - Execute cells in the kernel
- `AddNotebookCell` - Create new cells at specified positions
- `UpdateNotebookCell` - Modify existing cell content

**Read-Only Tools (Available in all modes - Ask, Edit, Agent):**
- `GetNotebookCells` - Read cell contents with status information
- `GetCellOutputs` - Retrieve cell execution outputs

Tool filtering in `extensions/positron-assistant/src/api.ts`:
```typescript
// Notebook modification tools are only available in Agent mode.
// Read-only tools (GetNotebookCells, GetCellOutputs) are available in all modes.
case PositronAssistantToolName.RunNotebookCells:
case PositronAssistantToolName.AddNotebookCell:
case PositronAssistantToolName.UpdateNotebookCell:
	if (!(inChatPane && hasActiveNotebook && isAgentMode)) {
		continue;
	}
	break;
```

### Tool Referencing

All notebook tools can be explicitly referenced by users in chat prompts. This allows users to signal their intent to use specific tools, though the model still decides whether to actually invoke them based on the request context.

**How to Reference Tools:**

1. **Using `#` syntax in the prompt:**
   - Type `#` followed by the tool reference name directly in the chat prompt
   - Example: `#runNotebookCells execute the first cell`
   - Example: `#getNotebookCells show me all cells`

2. **Via the attachment button (paperclip):**
   - Tools appear as attachable options in the chat UI
   - Users can click the paperclip button and select tools to attach

**Available Tool References:**

All notebook tools have `canBeReferencedInPrompt: true` and can be referenced using their `toolReferenceName`:

- **`#runNotebookCells`** - Execute cells in the kernel (Agent mode only)
- **`#addNotebookCell`** - Create new cells at specified positions (Agent mode only)
- **`#updateNotebookCell`** - Modify existing cell content (Agent mode only)
- **`#getCellOutputs`** - Retrieve cell execution outputs (All modes)
- **`#getNotebookCells`** - Read cell contents with status information (All modes)

**Important Notes:**

- Tool references add context to the prompt but don't force tool availability or usage
- Tools are still filtered by mode (modification tools only in Agent mode)
- The model receives the tool reference as context but decides whether to invoke it
- Tool availability still depends on notebook mode being active (notebook attached + active editor)

**Location:** Tool reference configuration in `extensions/positron-assistant/package.json`

### Behavioral Changes

**Without notebook mode (no attached notebook OR notebook not active editor):**
- General coding assistant
- Standard file/editor operations
- No notebook-specific tools available

**With notebook mode in Ask/Edit modes (notebook attached + active editor + Ask or Edit mode):**
- Notebook-aware assistant with **read-only access**
- Access to read-only tools:
  - `GetNotebookCells` - Read cell contents with status information (selection status, execution status, execution order, run success/failure, duration)
  - `GetCellOutputs` - Retrieve cell execution outputs
- Can view notebook context, analyze code, explain cells, and inspect outputs
- References cells by ID in responses
- System prompt includes selected cell content, metadata, and status information
- For small notebooks (< 20 cells), system prompt also includes all cell content and status via `allCells` field
- When modifications are requested, suggests switching to Agent mode

**With notebook mode in Agent mode (notebook attached + active editor + Agent mode):**
- Notebook-aware assistant with **full manipulation capabilities**
- Access to all notebook tools:
  - `GetNotebookCells` - Read cell contents with status information
  - `GetCellOutputs` - Retrieve cell execution outputs
  - `RunNotebookCells` - Execute cells in the kernel
  - `AddNotebookCell` - Create new cells at specified positions
  - `UpdateNotebookCell` - Modify existing cell content
- Can perform all operations: view, analyze, modify, execute, and create cells
- References cells by ID in responses
- Suggests cell-based operations including modifications
- System prompt includes selected cell content, metadata, and status information
- For small notebooks (< 20 cells), system prompt also includes all cell content and status via `allCells` field

## Prompt File Architecture

**Location:** `src/md/prompts/chat/`

Notebook instructions are split into mode-specific prompt files following the established pattern of mode-specific prompts (e.g., `agent.md`, `ask.md`, `edit.md`):

### `notebook-mode-agent.md`
- **Modes:** `agent`
- **Order:** 80
- **Description:** Full notebook manipulation instructions for Agent mode
- **Content:**
  - Complete tool list (all 5 tools: GetNotebookCells, GetCellOutputs, RunNotebookCells, AddNotebookCell, UpdateNotebookCell)
  - Full manipulation workflows (analyze, modify, add, execute, debug)
  - No restrictions on modifications
  - Emphasizes using tools instead of direct file access

### `notebook-mode-readonly.md`
- **Modes:** `[ask, edit]`
- **Order:** 80
- **Description:** Read-only notebook context and query tools for Ask/Edit modes
- **Content:**
  - Read-only tools only (GetNotebookCells, GetCellOutputs)
  - Analysis and explanation workflows
  - Clear guidance about mode limitations
  - Suggests switching to Agent mode when modifications are requested
  - Forbidden alternatives include attempting modifications

**Design Rationale:**

This separation ensures:
1. Appropriate tool availability without runtime conditionals in templates
2. Clear user guidance about capabilities per mode
3. Follows existing Positron Assistant architectural patterns
4. Makes mode-specific behavior explicit and maintainable

When the prompt renderer loads prompts for a specific mode, it automatically includes the appropriate notebook prompt file based on the YAML `mode` header.

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

**Location:** `src/positron-dts/positron.d.ts` (namespace `positron.notebooks`)

Full API namespace: `positron.notebooks`


## Implementation Approach

The current implementation uses **attached context detection** without API changes:

### What Was Implemented
✅ Check attached context for notebook files (`.ipynb`)
✅ Verify that attached notebook has an active editor
✅ Enable notebook mode only when both conditions are met
✅ Keep all logic in extension layer (no core API changes)
✅ Enable tool referencing for all notebook tools (`canBeReferencedInPrompt: true`)
✅ Add `toolReferenceName` properties for user-friendly tool references via `#` syntax

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

| Scenario | Notebook Attached? | Notebook Active Editor? | Mode | Notebook Mode? | Available Tools |
|----------|-------------------|------------------------|------|----------------|-----------------|
| 1 | ✅ Yes | ✅ Yes (same file) | Ask | ✅ ON (Read-only) | GetNotebookCells, GetCellOutputs |
| 2 | ✅ Yes | ✅ Yes (same file) | Edit | ✅ ON (Read-only) | GetNotebookCells, GetCellOutputs |
| 3 | ✅ Yes | ✅ Yes (same file) | Agent | ✅ ON (Full access) | All 5 tools |
| 4 | ✅ Yes | ❌ No (different file active) | Any | ❌ OFF | None |
| 5 | ❌ No | ✅ Yes | Any | ❌ OFF | None |
| 6 | ✅ Multiple notebooks | ✅ Yes (one is active) | Ask/Edit | ✅ ON (Read-only) | GetNotebookCells, GetCellOutputs |
| 7 | ✅ Multiple notebooks | ✅ Yes (one is active) | Agent | ✅ ON (Full access) | All 5 tools |
| 8 | ✅ Multiple notebooks | ❌ No (none active) | Any | ❌ OFF | None |

### How to Test

#### Test 1: Ask Mode - Read-Only Access
1. **Attach notebook file** using `@filename.ipynb` in chat
2. **Open notebook** in Positron notebook editor
3. **Switch to Ask mode** in the mode selector
4. **Verify behavior**:
   - Only read-only tools appear in tool list: `GetNotebookCells`, `GetCellOutputs`
   - Modification tools do NOT appear: `RunNotebookCells`, `AddNotebookCell`, `UpdateNotebookCell`
   - Read-only tools can be referenced using `#getNotebookCells` and `#getCellOutputs`
   - System prompt includes selected cell information with status
   - Ask "What does cell 1 do?" → Should work using GetNotebookCells
   - Ask "Run this cell" → Should suggest switching to Agent mode
   - Try referencing: `#getNotebookCells show me all cells` → Should work

#### Test 2: Edit Mode - Read-Only Access
1. **Attach notebook file** using `@filename.ipynb` in chat
2. **Open notebook** in Positron notebook editor
3. **Switch to Edit mode** in the mode selector
4. **Verify behavior**:
   - Only read-only tools appear in tool list: `GetNotebookCells`, `GetCellOutputs`
   - Modification tools do NOT appear
   - Read-only tools can be referenced using `#getNotebookCells` and `#getCellOutputs`
   - Ask "Show me the output of cell 2" → Should use GetCellOutputs
   - Ask "Update cell 3 to add error handling" → Should suggest switching to Agent mode
   - Try referencing: `#getCellOutputs show outputs for cell 2` → Should work

#### Test 3: Agent Mode - Full Access
1. **Attach notebook file** using `@filename.ipynb` in chat
2. **Open notebook** in Positron notebook editor
3. **Switch to Agent mode** in the mode selector
4. **Verify behavior**:
   - All 5 notebook tools appear in tool list
   - All tools can be referenced: `#runNotebookCells`, `#addNotebookCell`, `#updateNotebookCell`, `#getCellOutputs`, `#getNotebookCells`
   - Request cell modification → Should use UpdateNotebookCell
   - Request cell execution → Should use RunNotebookCells
   - Request adding new cell → Should use AddNotebookCell
   - Assistant can perform all notebook operations
   - Try referencing: `#runNotebookCells execute cell 1` → Should work
   - Try referencing: `#addNotebookCell add a new markdown cell at the end` → Should work

#### Test 4: Without Attached Notebook
1. **Do NOT attach any notebook file**
2. **Open a notebook** in Positron notebook editor
3. **Verify behavior**:
   - No notebook tools appear in any mode
   - No notebook context in system prompt
   - Assistant behaves as general coding assistant

#### Test 5: Prompt File Loading
1. Enable trace logging in the extension
2. Attach notebook and switch between modes
3. Check console logs to verify:
   - Ask mode loads `notebook-mode-readonly.md`
   - Edit mode loads `notebook-mode-readonly.md`
   - Agent mode loads `notebook-mode-agent.md`

#### Test 6: Tool Referencing
1. **Attach notebook file** using `@filename.ipynb` in chat
2. **Open notebook** in Positron notebook editor
3. **Test `#` syntax referencing:**
   - In Ask/Edit mode: Try `#getNotebookCells show all cells` → Should work
   - In Ask/Edit mode: Try `#getCellOutputs show outputs` → Should work
   - In Ask/Edit mode: Try `#runNotebookCells execute cell` → Should suggest switching to Agent mode (tool not available)
   - In Agent mode: Try `#runNotebookCells execute cell 1` → Should work
   - In Agent mode: Try `#addNotebookCell add markdown cell` → Should work
   - In Agent mode: Try `#updateNotebookCell update cell 2` → Should work
4. **Test attachment button:**
   - Click paperclip button in chat
   - Verify notebook tools appear in the attachment list (only available ones based on mode)
   - Attach a tool and verify it's added to the prompt context
5. **Verify behavior:**
   - Tool references appear in `request.toolReferences` array
   - Model receives tool reference context but still decides whether to use it
   - Tool availability still respects mode restrictions (modification tools only in Agent mode)

