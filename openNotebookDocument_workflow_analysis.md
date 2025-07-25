# openNotebookDocument() Workflow Analysis

## Execution Context Legend

### 🔵 Extension Host Process
- Where VS Code extensions run
- Isolated from the main VS Code process for stability
- Communicates with main process via RPC (Remote Procedure Call)
- Contains: `extHost*` classes, extension code

### 🟢 Main Process (Renderer)
- The main VS Code/Positron UI process
- Handles all UI rendering and user interactions
- Contains: `mainThread*` classes, services, editor panes
- Manages the actual notebook models and widgets

### 🔄 RPC Boundary
- Communication between Extension Host and Main Process
- Uses proxy objects for cross-process calls
- Methods prefixed with `$` indicate RPC endpoints
- Example: `$tryOpenNotebook` is called from extension host

### 📦 Service Layer
- Shared services available in both processes
- Dependency injection provides appropriate implementations
- Key services: `INotebookService`, `INotebookEditorModelResolverService`

## Overview
This document traces the complete workflow from the VS Code API `openNotebookDocument()` call through to the creation and association of notebook editors and widgets. It identifies key integration points where Positron notebooks need to intercept or modify the flow.

## Current VS Code Notebook Workflow

### 1. API Entry Point 🔵 Extension Host
**Location**: `src/vs/workbench/api/common/extHost.api.impl.ts:1093-1104`

```typescript
async openNotebookDocument(uriOrType?: URI | string, content?: vscode.NotebookData) {
    let uri: URI;
    if (URI.isUri(uriOrType)) {
        uri = uriOrType;
        await extHostNotebook.openNotebookDocument(uriOrType);
    } else if (typeof uriOrType === 'string') {
        uri = URI.revive(await extHostNotebook.createNotebookDocument({ viewType: uriOrType, content }));
    } else {
        throw new Error('Invalid arguments');
    }
    return extHostNotebook.getNotebookDocument(uri).apiNotebook;
}
```

### 2. Extension Host Layer 🔵 Extension Host
**Location**: `src/vs/workbench/api/common/extHostNotebook.ts`

- `openNotebookDocument()`: Makes RPC call to main thread via `_notebookDocumentsProxy.$tryOpenNotebook(uri)`
- `createNotebookDocument()`: Makes RPC call via `_notebookDocumentsProxy.$tryCreateNotebook(options)`

### 🔄 RPC Boundary Crossed Here

### 3. Main Thread Handler 🟢 Main Process
**Location**: `src/vs/workbench/api/browser/mainThreadNotebookDocuments.ts`

```typescript
async $tryOpenNotebook(uriComponents: UriComponents): Promise<URI> {
    const uri = URI.revive(uriComponents);
    const ref = await this._notebookEditorModelResolverService.resolve(uri, undefined);
    // Handle untitled notebooks...
    return uri;
}

async $tryCreateNotebook(options: { viewType: string; content?: NotebookDataDto }): Promise<UriComponents> {
    const ref = await this._notebookEditorModelResolverService.resolve(
        { untitledResource: undefined },
        options.viewType
    );
    // Apply content and return URI...
}
```

### 4. Model Resolution 🟢 Main Process
**Service**: `INotebookEditorModelResolverService`
**Implementation**: `src/vs/workbench/contrib/notebook/common/notebookEditorModelResolverServiceImpl.ts`

- Creates or retrieves notebook models
- Manages model lifecycle and references
- Creates `SimpleNotebookEditorModel` instances

### 5. Editor Input Creation 🟢 Main Process
**Location**: Various entry points lead to `NotebookEditorInput.getOrCreate()`

- File-based: Editor resolver service creates inputs based on file associations
- API-based: Currently always creates VS Code `NotebookEditorInput`
    - This is the key issue, we want to make sure that we can create positron editor inputs if the notebook is a .ipynb file and the user has set the default editor to positron.

### 6. Editor Pane and Widget Creation 🟢 Main Process
**When**: User opens the notebook in the UI

1. **Editor Pane**: `NotebookEditor.setInput()` is called
2. **Widget Retrieval**: Uses `INotebookEditorService.retrieveWidget()`
3. **Widget Creation**: `NotebookEditorWidget` is instantiated via `NotebookEditorWidgetService`

## Key Classes and Services

### NotebookEditorInput
- Represents a notebook document in the editor
- Created via static `getOrCreate()` method
- Manages the relationship to the underlying model

### NotebookEditor (EditorPane)
- The editor pane that hosts the notebook widget
- Handles `setInput()` to display a notebook
- Manages widget lifecycle and state

### NotebookEditorWidget
- The actual notebook UI implementation
- Created and managed by `NotebookEditorWidgetService`
- Can be reused across different inputs

### NotebookEditorWidgetService
- Manages widget instances for reuse
- Creates widgets with proper service injection
- Handles borrowing/returning of widgets

## Integration Points for Positron Notebooks

### 1. API-Level Interception
**Problem**: API calls currently always create VS Code notebook models

**Solution**: Modify `MainThreadNotebookDocuments` to check configuration:
```typescript
// In $tryOpenNotebook and $tryCreateNotebook
const defaultEditor = configurationService.getValue<string>('positron.notebooks.defaultEditor');
if (defaultEditor === 'positron') {
    // Create Positron notebook input instead
}
```

### 2. Model Resolution
**Problem**: `INotebookEditorModelResolverService` creates VS Code models

**Options**:
1. Create a parallel Positron model resolver service
2. Extend the existing service to handle both types
3. Use the same models but different editor inputs

### 3. Editor Input Types
**Current State**:
- `NotebookEditorInput` for VS Code notebooks
- `PositronNotebookEditorInput` for Positron notebooks

**Need**: Ensure API creates the correct input type based on configuration

### 4. Widget Management
**Current Positron Implementation**:
- Direct widget creation in `setInput()` method
- Uses `PositronNotebookInstance.getOrCreate()` for instance management
- Instance map prevents duplicate instances for same resource
- No widget service - React component created directly in editor pane

**VS Code Implementation**:
- Service-based widget management with reuse
- `NotebookEditorWidgetService` manages widget lifecycle
- Supports borrowing/returning widgets for efficiency

**Key Differences**:
- Positron uses instance-based approach vs VS Code's widget-based approach
- Positron's `PositronNotebookInstance` serves as the central state manager
- No widget borrowing/returning mechanism in Positron currently

**Recommendation**: Current approach works but could benefit from service-based management for consistency

## Proposed Implementation Strategy

### Phase 1: Configuration-Aware API
1. Add configuration check in `MainThreadNotebookDocuments`
2. Route to appropriate input creation based on setting
3. Ensure proper view type detection

### Phase 2: Widget Service Implementation
1. Create `IPositronNotebookEditorService` interface
2. Implement widget borrowing/returning logic
3. Update `PositronNotebookEditor` to use the service

### Phase 3: Model Integration
1. Determine if separate models are needed
2. Implement any necessary model adaptations
3. Ensure compatibility with existing notebook services

## Configuration Flow
```
User Setting: positron.notebooks.defaultEditor
    ↓
API Call: openNotebookDocument()
    ↓
Main Thread: Check configuration
    ↓
Branch: VS Code path OR Positron path
    ↓
Create appropriate EditorInput
    ↓
Open in corresponding editor
```

## Testing Considerations

1. **API Compatibility**: Ensure extensions work with both notebook types
2. **Configuration Changes**: Test switching default editor preference
3. **Model Lifecycle**: Verify proper cleanup and resource management
4. **Widget Reuse**: Test multiple notebooks of same type
5. **Mixed Usage**: Test having both notebook types open simultaneously

## Open Questions - ANSWERED

1. **Should Positron notebooks use the same underlying models as VS Code notebooks?**
   - **Answer**: YES - Positron notebooks use the same `NotebookTextModel` and `INotebookEditorModelResolverService`
   - This is confirmed in `PositronNotebookEditorInput.resolve()` which uses the standard notebook model resolver
   - Benefits: Reuses existing model infrastructure, maintains compatibility

2. **How should kernel/execution integration work across both systems?**
   - **Answer**: Positron uses its own runtime session approach
   - Uses `IRuntimeSessionService` and `ILanguageRuntimeSession` instead of VS Code's kernel system
   - Execution is handled through the Positron runtime infrastructure
   - Cell execution uses the standard `INotebookExecutionService` but with Positron's runtime backend

3. **What happens when switching default editor with notebooks already open?**
   - **Answer**: Currently open notebooks remain in their current editor
   - The configuration change only affects newly opened notebooks
   - No automatic migration or switching of active editors

4. **Should there be a migration path between notebook types?**
   - **Answer**: Not currently implemented, but the shared model approach makes this feasible
   - Since both use the same underlying `NotebookTextModel`, a migration would primarily involve:
     - Creating a new editor input of the target type
     - Closing the current editor
     - Opening the new editor with the same model

## Implementation Details Discovered

### Positron Notebook Architecture
1. **Model Sharing**: Positron notebooks reuse VS Code's notebook model infrastructure
2. **Instance Management**: Uses `PositronNotebookInstance` as the central coordinator
3. **Runtime Integration**: Leverages Positron's runtime session service instead of VS Code kernels
4. **UI Approach**: React-based components with direct rendering

### Key Architectural Decisions
- **Shared Models**: Simplifies integration and maintains compatibility
- **Separate Execution**: Allows Positron-specific runtime features
- **Instance Pattern**: Provides clean separation between UI and state management

## Next Steps

1. **Implement configuration checking in MainThreadNotebookDocuments**
   - Add config check for `positron.notebooks.defaultEditor`
   - Route to appropriate input creation based on preference

2. **Handle API-created notebooks**
   - Ensure `$tryOpenNotebook` and `$tryCreateNotebook` respect configuration
   - Test with various extension scenarios

3. **Consider widget service implementation**
   - Evaluate if current instance-based approach is sufficient
   - Implement service if widget reuse becomes important

4. **Document behavioral differences**
   - Create documentation for extension authors
   - Note any API differences or limitations
