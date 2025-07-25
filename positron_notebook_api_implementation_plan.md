# Positron Notebook API Implementation Plan

## Objective
Enable the VS Code API `openNotebookDocument()` to respect the native editor resolution rules when creating notebooks programmatically, ensuring that .ipynb files open in the appropriate editor (VS Code or Positron) based on the user's editor associations.

## Background
- See [openNotebookDocument_workflow_analysis.md](./openNotebookDocument_workflow_analysis.md) for detailed workflow analysis
- Currently, API-created notebooks always open in the VS Code notebook editor
- File-based opening already respects editor associations correctly
- Need to align API-based opening with file-based opening behavior

## Problem Statement
When extensions call `vscode.workspace.openNotebookDocument()`, the resulting notebook always uses VS Code's notebook editor, bypassing the native editor resolution mechanism. The API call flow goes through `MainThreadNotebookDocuments.$tryOpenNotebook()` which directly creates `NotebookEditorInput` without consulting the editor resolution rules.

## Solution Overview
Modify the `MainThreadNotebookDocuments.$tryOpenNotebook()` and `$tryCreateNotebook()` methods to use the native editor resolution mechanism before creating editor inputs. This ensures API-based notebook opening respects the same editor associations as file-based opening. The implementation includes robust error handling and proper logging for diagnostics.

## Implementation Details

### 1. File to Modify
**Location**: `src/vs/workbench/api/browser/mainThreadNotebookDocuments.ts`

**Class**: `MainThreadNotebookDocuments`

**Methods**: 
- `$tryOpenNotebook(uriComponents: UriComponents): Promise<URI>`
- `$tryCreateNotebook(options: { viewType: string; content?: NotebookDataDto }): Promise<UriComponents>`

### 2. Required Changes

#### Step 1: Add Service Dependencies
Add required service dependencies to the `MainThreadNotebookDocuments` constructor:

```typescript
constructor(
    extHostContext: IExtHostContext,
    @INotebookEditorModelResolverService private readonly _notebookEditorModelResolverService: INotebookEditorModelResolverService,
    @INotebookService private readonly _notebookService: INotebookService,
    @INotebookEditorService private readonly _notebookEditorService: INotebookEditorService,
    @IInstantiationService private readonly _instantiationService: IInstantiationService,
    @IEditorService private readonly _editorService: IEditorService,
    @IEditorGroupsService private readonly _editorGroupsService: IEditorGroupsService,
    @IConfigurationService private readonly _configurationService: IConfigurationService, // ADD THIS
    @INotificationService private readonly _notificationService: INotificationService, // ADD THIS
    @ILogService private readonly _logService: ILogService, // ADD THIS
) {
    super();
    // ... existing code
}
```

#### Step 2: Import Required Types
Add the following imports at the top of the file:

```typescript
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { PositronNotebookEditorInput } from '../../positronNotebook/browser/PositronNotebookEditorInput.js';
import { usingPositronNotebooks } from '../../../services/positronNotebook/common/positronNotebookUtils.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
```

#### Step 3: Modify $tryOpenNotebook Method
Replace the existing `$tryOpenNotebook` method with:

```typescript
async $tryOpenNotebook(uriComponents: UriComponents): Promise<URI> {
    const uri = URI.revive(uriComponents);
    const ref = await this._notebookEditorModelResolverService.resolve(uri, undefined);
    
    // --- Start Positron ---
    // Check if this is a Jupyter notebook and if Positron notebooks are configured as default
    const resourcePath = uri.path.toLowerCase();
    const isJupyterNotebook = resourcePath.endsWith('.ipynb');
    
    if (isJupyterNotebook && usingPositronNotebooks(this._configurationService)) {
        this._logService.trace('[Positron] Opening notebook with Positron editor based on editor association for:', uri.toString());
        
        try {
            // Get the preferred editor group
            const preferredGroup = this._editorGroupsService.activeGroup;
            
            // Create Positron notebook editor input
            const editorInput = PositronNotebookEditorInput.getOrCreate(
                this._instantiationService,
                uri,
                undefined,
                ref.object.viewType
            );
            
            // Open the editor
            await this._editorService.openEditor(editorInput, undefined, preferredGroup);
            
            // Handle untitled notebook case
            if (ref.object.isUntitled()) {
                await this._proxy.$acceptDirtyStateChanged(uri, true);
            }
            
            return uri;
        } catch (error) {
            // Log error and show warning to user
            this._logService.error('[Positron] Failed to open notebook with Positron editor:', error);
            this._notificationService.warn(
                `Failed to open notebook with Positron editor. Falling back to VS Code editor. Error: ${error.message}`
            );
            // Fall through to VS Code editor logic
        }
    }
    // --- End Positron ---
    
    // Original VS Code logic for opening notebooks
    // Handle untitled notebooks
    if (ref.object.isUntitled()) {
        await this._proxy.$acceptDirtyStateChanged(uri, true);
    }
    
    // Let the standard editor resolution handle it (will create VS Code notebook editor)
    return uri;
}
```

#### Step 4: Modify $tryCreateNotebook Method
Add similar logic to the `$tryCreateNotebook` method:

```typescript
async $tryCreateNotebook(options: { viewType: string; content?: NotebookDataDto }): Promise<UriComponents> {
    const ref = await this._notebookEditorModelResolverService.resolve(
        { untitledResource: undefined },
        options.viewType
    );
    
    // Apply content if provided
    if (options.content) {
        const data = NotebookDto.fromNotebookDataDto(options.content);
        ref.object.notebook.reset(data.cells, data.metadata, ref.object.notebook.transientOptions);
    }
    
    // --- Start Positron ---
    // Check if untitled notebooks should use Positron editor for .ipynb
    const uri = ref.object.resource;
    const isJupyterViewType = options.viewType === 'jupyter-notebook' || options.viewType === 'interactive';
    
    if (isJupyterViewType && usingPositronNotebooks(this._configurationService)) {
        this._logService.trace('[Positron] Creating new notebook with Positron editor based on configuration');
        
        try {
            // Get the preferred editor group
            const preferredGroup = this._editorGroupsService.activeGroup;
            
            // Create Positron notebook editor input
            const editorInput = PositronNotebookEditorInput.getOrCreate(
                this._instantiationService,
                uri,
                undefined,
                options.viewType
            );
            
            // Open the editor
            await this._editorService.openEditor(editorInput, undefined, preferredGroup);
            
            // Mark as dirty since it's new
            await this._proxy.$acceptDirtyStateChanged(uri, true);
            
            return uri.toJSON();
        } catch (error) {
            // Log error and show warning to user
            this._logService.error('[Positron] Failed to create notebook with Positron editor:', error);
            this._notificationService.warn(
                `Failed to create notebook with Positron editor. Falling back to VS Code editor. Error: ${error.message}`
            );
            // Fall through to VS Code editor logic
        }
    }
    // --- End Positron ---
    
    // Original VS Code logic
    await this._proxy.$acceptDirtyStateChanged(ref.object.resource, true);
    return ref.object.resource.toJSON();
}
```

### 3. How It Works

1. **API Call**: Extension calls `vscode.workspace.openNotebookDocument(uri)` or creates a new notebook
2. **RPC Communication**: Extension host sends request to main process via RPC
3. **Main Thread Handler**: `MainThreadNotebookDocuments` receives the request:
   - `$tryOpenNotebook` for existing notebooks
   - `$tryCreateNotebook` for new notebooks
4. **Model Creation**: VS Code creates a notebook model via `INotebookEditorModelResolverService`
5. **Editor Resolution**: The modified methods now:
   - Perform case-insensitive check for .ipynb files
   - Use the `usingPositronNotebooks` utility function to check editor associations
   - Respect the same configuration setting used by file-based opening
   - Log the editor selection for diagnostics
6. **Editor Input Creation & Opening**: 
   - Create `PositronNotebookEditorInput` if resolved to Positron editor
   - Open the editor using `IEditorService.openEditor()`
   - Fall back to standard VS Code behavior on error with user warning
   - Handle untitled/dirty state appropriately

### 4. Editor Resolution Mechanism

The implementation leverages VS Code's native configuration system:
- Uses the `usingPositronNotebooks` utility function to check `workbench.editorAssociations`
- Respects user's editor associations (set via "Reopen With" or settings.json)
- Aligns API-based opening with file-based opening behavior
- Single configuration point for both file-based and API-based notebook opening

## Testing Plan

### 1. Manual Testing
1. Set .ipynb files to open with Positron notebook editor (via "Reopen With" → "Configure Default Editor")
2. Use an extension that calls `vscode.workspace.openNotebookDocument()` (e.g., Jupyter extension)
3. Verify the notebook opens in Positron editor
4. Check console logs for trace messages confirming editor selection
5. Change default editor association to VS Code notebook editor and repeat
6. Verify the notebook opens in VS Code editor

### 2. Error Handling Testing
1. Simulate error in Positron editor creation (e.g., throw in constructor)
2. Verify warning notification appears to user
3. Verify fallback to VS Code editor works correctly
4. Check error is logged in console

### 3. Editor Resolution Testing
1. Test with different editor associations:
   - Default VS Code notebook editor
   - Positron notebook editor
   - No explicit association (system default)
2. Verify API-created notebooks follow the same rules as file-based opening

### 4. Test Scenarios
- [ ] API-created new notebooks respect editor associations
- [ ] API-opened existing notebooks respect editor associations
- [ ] File-based opening continues to work correctly
- [ ] Mixed scenario: Both editor types can be open simultaneously
- [ ] Editor association changes affect new notebooks appropriately
- [ ] Case-insensitive file extension matching (.ipynb, .IPYNB, .Ipynb)
- [ ] Error recovery with user notification
- [ ] Non-.ipynb notebooks continue to use VS Code editor

### 5. Extension Compatibility Testing
Test with common notebook extensions:
- Jupyter
- .NET Interactive
- Polyglot Notebooks
- Any custom notebook providers

## Potential Issues & Mitigations

### 1. Extension Compatibility
**Issue**: Some extensions might expect VS Code notebook editor specifically
**Mitigation**: 
- Uses same editor resolution as file-based opening, maintaining consistency
- Error handling ensures graceful fallback if Positron editor fails
- Clear logging helps diagnose extension-specific issues

### 2. Feature Parity
**Issue**: Positron notebooks might not support all VS Code notebook features
**Mitigation**: 
- Document known limitations for extension authors
- User warning on error provides transparency

### 3. Performance
**Issue**: Additional checks on every editor creation
**Mitigation**: 
- Editor resolver service lookup is already optimized
- Case-insensitive path check is minimal overhead
- Only applies to .ipynb files, not all notebooks

### 4. Editor Association Changes
**Issue**: Users might be confused about which editor will be used
**Mitigation**:
- Follows same rules as file-based opening for consistency
- Clear documentation about editor associations
- VS Code UI already shows current default editor

### 5. Error Visibility
**Issue**: Users need to understand when and why fallback occurs
**Mitigation**:
- Warning notifications provide immediate feedback
- Detailed error logging for developers
- Clear error messages include the actual error details

## Future Enhancements

1. **Per-extension configuration**: Allow different defaults for different extensions
2. **Migration tools**: Help users migrate between notebook types
3. **Dynamic switching**: Allow switching editor type for open notebooks
4. **Extension API**: Expose editor preference to extensions

## Related Documentation
- [Workflow Analysis](./openNotebookDocument_workflow_analysis.md) - Detailed technical flow
- [Positron Notebook Architecture](./src/vs/workbench/contrib/positronNotebook/docs/positron_notebooks_architecture.md) - Positron notebook design

## Implementation Summary

The updated implementation provides:
1. **Correct integration point** in `MainThreadNotebookDocuments` where API calls are actually handled
2. **Consistent configuration checking** using the `usingPositronNotebooks` utility function
3. **Comprehensive error handling** with user-visible warnings and fallback behavior
4. **Diagnostic logging** for debugging and monitoring
5. **Minimal upstream impact** following Positron's guidelines

Key aspects of the implementation:
- Intercepts at the correct point in the API call flow
- Uses `usingPositronNotebooks` to check editor associations consistently
- Opens editors directly using `IEditorService.openEditor()`
- Aligns API-based opening with file-based opening behavior
- Added notification service for user warnings
- Added log service for diagnostic traces
- Added try-catch with graceful fallback
- Case-insensitive file extension matching
- Clear error messages with actual error details
- Reuses existing utility function for DRY principle

## Code Review Checklist
- [ ] Follows Positron code organization guidelines (minimal upstream changes)
- [ ] Uses `// --- Start Positron ---` and `// --- End Positron ---` comments
- [ ] Imports are properly organized
- [ ] Uses `usingPositronNotebooks` utility function for configuration checking
- [ ] No breaking changes to existing functionality
- [ ] Tested with both editor types
- [ ] Error handling with user notifications works correctly
- [ ] Logging provides sufficient diagnostic information
- [ ] Respects user's editor associations
- [ ] Performance impact is minimal