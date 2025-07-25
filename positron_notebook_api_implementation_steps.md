# Positron Notebook API Implementation Steps

## Overview
This document provides a step-by-step implementation guide for enabling the VS Code API `openNotebookDocument()` to respect native editor resolution rules when creating notebooks programmatically. The implementation is broken down into discrete, atomic commits that can be implemented and tested sequentially.

## Implementation Principles
- **Minimal upstream impact**: All changes contained within clearly marked Positron sections
- **Atomic commits**: Each commit is self-contained and testable independently
- **Progressive enhancement**: Each commit builds on previous work without breaking existing functionality
- **Comprehensive error handling**: Fallback behavior ensures no regression
- **Testability**: Each commit includes specific testing approaches

## Implementation Steps

### Step 1: Add Service Dependencies to MainThreadNotebookDocuments

**Commit Title:** `feat(notebook-api): Add service dependencies for Positron notebook integration`

**Objective:** Inject required services into MainThreadNotebookDocuments to support Positron notebook integration.

**Files to Modify:**
- `src/vs/workbench/api/browser/mainThreadNotebookDocuments.ts`

**Implementation Details:**

1. Add the following imports at the top of the file:
```typescript
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IEditorService } from '../../services/editor/common/editorService.js';
import { IEditorGroupsService } from '../../services/editor/common/editorGroupsService.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
```

2. Update the constructor to inject these services:
```typescript
constructor(
    extHostContext: IExtHostContext,
    @INotebookEditorModelResolverService private readonly _notebookEditorModelResolverService: INotebookEditorModelResolverService,
    @INotebookService private readonly _notebookService: INotebookService,
    @INotebookEditorService private readonly _notebookEditorService: INotebookEditorService,
    @IInstantiationService private readonly _instantiationService: IInstantiationService,
    @IEditorService private readonly _editorService: IEditorService,
    @IEditorGroupsService private readonly _editorGroupsService: IEditorGroupsService,
    @IConfigurationService private readonly _configurationService: IConfigurationService,
    @INotificationService private readonly _notificationService: INotificationService,
    @ILogService private readonly _logService: ILogService,
) {
    super();
    // ... existing code
}
```

**Testing Checklist:**
- [ ] Class instantiates correctly with new dependencies
- [ ] No runtime errors from missing services
- [ ] Existing functionality remains unaffected
- [ ] TypeScript compilation succeeds

**Prerequisites:** None

---

### Step 2: Import Positron Notebook Utilities and Types

**Commit Title:** `feat(notebook-api): Import Positron notebook types and utilities`

**Objective:** Add necessary imports for Positron notebook support.

**Files to Modify:**
- `src/vs/workbench/api/browser/mainThreadNotebookDocuments.ts`

**Implementation Details:**

Add the following imports after the service imports:
```typescript
import { PositronNotebookEditorInput } from '../../contrib/positronNotebook/browser/PositronNotebookEditorInput.js';
import { usingPositronNotebooks } from '../../services/positronNotebook/common/positronNotebookUtils.js';
```

**Testing Checklist:**
- [ ] Imports resolve correctly
- [ ] No circular dependency issues
- [ ] TypeScript compilation succeeds
- [ ] No unused import warnings

**Prerequisites:** Step 1 completed

---

### Step 3: Implement Positron Notebook Support in $tryOpenNotebook

**Commit Title:** `feat(notebook-api): Add Positron notebook support to $tryOpenNotebook`

**Objective:** Modify the `$tryOpenNotebook` method to respect editor associations when opening notebooks via API.

**Files to Modify:**
- `src/vs/workbench/api/browser/mainThreadNotebookDocuments.ts`

**Implementation Details:**

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

**Testing Checklist:**
- [ ] Opening .ipynb files via API with Positron as default opens Positron editor
- [ ] Opening .ipynb files via API with VS Code as default opens VS Code editor
- [ ] Opening non-.ipynb notebooks uses VS Code editor
- [ ] Case-insensitive file extension matching works (.ipynb, .IPYNB, .Ipynb)
- [ ] Error recovery shows warning notification and falls back gracefully
- [ ] Logging output appears in console with trace level
- [ ] Untitled notebook handling works correctly

**Prerequisites:** Steps 1 & 2 completed

---

### Step 4: Implement Positron Notebook Support in $tryCreateNotebook

**Commit Title:** `feat(notebook-api): Add Positron notebook support to $tryCreateNotebook`

**Objective:** Modify the `$tryCreateNotebook` method to respect editor associations when creating new notebooks via API.

**Files to Modify:**
- `src/vs/workbench/api/browser/mainThreadNotebookDocuments.ts`

**Implementation Details:**

Modify the `$tryCreateNotebook` method to include Positron notebook handling:

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

**Testing Checklist:**
- [ ] Creating new notebooks via API with Positron as default opens Positron editor
- [ ] Creating new notebooks via API with VS Code as default opens VS Code editor
- [ ] Creating notebooks with initial content works correctly
- [ ] View type detection correctly identifies Jupyter notebooks
- [ ] Error recovery shows warning notification and falls back gracefully
- [ ] Dirty state is properly set for new notebooks
- [ ] Return value is correct URI components

**Prerequisites:** Steps 1, 2 & 3 completed

---

### Step 5: Fix Existing Notebook Handling Logic

**Commit Title:** `fix(notebook-api): Update untitled notebook handling for both paths`

**Objective:** Ensure untitled notebook handling and disposal work correctly in both code paths.

**Files to Modify:**
- `src/vs/workbench/api/browser/mainThreadNotebookDocuments.ts`

**Implementation Details:**

1. Review both methods to ensure:
   - Untitled notebook disposal handlers are properly registered
   - Return values are consistent
   - No duplicate handling of untitled state
   - Proxy calls are made at appropriate times

2. Fix any issues identified during testing of steps 3 & 4

**Testing Checklist:**
- [ ] Untitled notebooks work correctly in both editors
- [ ] Disposal handlers are properly registered
- [ ] Save operations work correctly
- [ ] No duplicate dirty state notifications
- [ ] Both methods return expected values

**Prerequisites:** Steps 3 & 4 completed

---

### Step 6: Add Unit Tests for Configuration Checking

**Commit Title:** `test(notebook-api): Add tests for Positron notebook API integration`

**Objective:** Create comprehensive unit tests for the new functionality.

**Files to Create:**
- `src/vs/workbench/api/browser/mainThreadNotebookDocuments.test.ts`

**Implementation Details:**

Create a test suite covering:

```typescript
import { TestInstantiationService } from '../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
// ... other imports

suite('MainThreadNotebookDocuments - Positron Integration', () => {
    let instantiationService: TestInstantiationService;
    let configurationService: IConfigurationService;
    
    setup(() => {
        instantiationService = new TestInstantiationService();
        // Set up mock services
    });
    
    test('should open .ipynb with Positron editor when configured', async () => {
        // Test implementation
    });
    
    test('should open .ipynb with VS Code editor when not configured', async () => {
        // Test implementation
    });
    
    test('should handle case-insensitive file extensions', async () => {
        // Test implementation
    });
    
    test('should fall back to VS Code editor on error', async () => {
        // Test implementation
    });
    
    test('should create new notebooks with correct editor', async () => {
        // Test implementation
    });
    
    // Additional tests...
});
```

**Testing Checklist:**
- [ ] All test cases pass
- [ ] Mock services work correctly
- [ ] Code coverage > 80% for new code
- [ ] Tests run in CI pipeline

**Prerequisites:** All implementation steps completed

---

### Step 7: Add E2E Tests for API Notebook Opening

**Commit Title:** `test(notebook-api): Add E2E tests for API-based notebook opening`

**Objective:** Create end-to-end tests that verify the complete integration.

**Files to Create:**
- `test/e2e/tests/notebook-api-integration.test.ts`

**Implementation Details:**

```typescript
import { test, expect } from '@playwright/test';
import { Application } from '../application';

test.describe('Notebook API Integration', () => {
    test('API opens notebooks with correct editor based on configuration', async () => {
        // Test implementation
    });
    
    test('Extension compatibility with API-created notebooks', async () => {
        // Test implementation
    });
    
    test('Error scenarios and recovery', async () => {
        // Test implementation
    });
});
```

**Testing Checklist:**
- [ ] E2E tests pass in both configurations
- [ ] UI behavior matches expectations
- [ ] Extension compatibility verified
- [ ] Error scenarios handled correctly

**Prerequisites:** All implementation steps completed

---

### Step 8: Update Documentation

**Commit Title:** `docs(notebook-api): Document API notebook resolution behavior`

**Objective:** Document the new behavior for users and extension authors.

**Files to Create:**
- `src/vs/workbench/contrib/positronNotebook/docs/api-integration.md`

**Implementation Details:**

Create documentation covering:

```markdown
# Positron Notebook API Integration

## Overview
This document describes how the VS Code notebook API respects editor associations when creating or opening notebooks programmatically.

## Configuration
Users can configure their preferred notebook editor using the standard VS Code editor associations:

```json
{
    "workbench.editorAssociations": {
        "*.ipynb": "workbench.editor.positronNotebook"
    }
}
```

## API Behavior
When extensions call `vscode.workspace.openNotebookDocument()`:
- The API checks the user's editor associations
- .ipynb files open in the configured editor (Positron or VS Code)
- Non-.ipynb notebooks always use VS Code editor
- Errors fall back gracefully to VS Code editor

## Extension Author Guide
...

## Troubleshooting
...
```

**Documentation Checklist:**
- [ ] Configuration options clearly explained
- [ ] API behavior documented
- [ ] Migration guide for extension authors
- [ ] Troubleshooting steps included
- [ ] Examples work as described

**Prerequisites:** Implementation complete and tested

---

## Risk Assessment

- **Low Risk (Steps 1-2):** Only add dependencies and imports, no behavior changes
- **Medium Risk (Steps 3-5):** Core functionality with comprehensive error handling
- **Low Risk (Steps 6-8):** Testing and documentation

## Rollback Plan

If issues are discovered:
1. The Positron-specific code is clearly marked with comments
2. Can be temporarily disabled by removing the conditional checks
3. Falls back to VS Code editor automatically on any error
4. No changes to existing VS Code behavior outside marked sections

## Success Criteria

- [ ] API-created notebooks respect editor associations
- [ ] No regression in existing functionality
- [ ] Error cases handled gracefully
- [ ] Performance impact negligible
- [ ] Extension compatibility maintained
- [ ] Comprehensive test coverage
- [ ] Documentation complete

## Notes for Implementers

1. Always use `// --- Start Positron ---` and `// --- End Positron ---` comments
2. Test each step independently before proceeding
3. Monitor console logs during development (trace level)
4. Use VS Code's notification system for user-visible errors
5. Ensure TypeScript strict mode compliance
6. Follow existing code style and patterns