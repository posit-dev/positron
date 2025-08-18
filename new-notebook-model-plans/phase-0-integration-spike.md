# Phase 0: Integration Spike - Positron Notebook Model
## Timeline: Weeks 0-2

## Executive Summary
This phase validates the technical approach for replacing VS Code's complex notebook model with a simplified Positron-specific implementation. The spike proves three critical integration points: UI adapter boundaries, working copy integration, and minimal runtime attachment. This is a proof-of-concept phase that establishes the foundation for all subsequent development.

## Background Context

### Why This Phase Is Critical
The integration spike de-risks the entire project by validating that our simplified model can:
1. Integrate with VS Code's working copy service for save/backup/hot-exit
2. Render cells through the existing Positron notebook UI
3. Attach to runtime sessions without breaking existing kernel UI
4. Maintain dirty state tracking and autosave functionality

### Architecture Context
VS Code's current notebook model uses a complex operation-based system designed for extension compatibility:
```
NotebookTextModel → ICellEditOperation → NotebookOperationManager → UndoRedoService
```

Our simplified approach eliminates the operation indirection:
```
PositronNotebookModel → Direct Methods → Working Copy Adapter → IUndoRedoService
```

## Phase Goals

### Primary Objectives
1. **Validate UI Integration**: Prove cells can render from the new model
2. **Prove Working Copy Integration**: Demonstrate save/backup/hot-exit functionality
3. **Attach to Runtime**: Minimal connection without replacing kernel UI
4. **Event System Validation**: Ensure change notifications work correctly

### Success Criteria
- ✅ Cells render correctly in the notebook editor
- ✅ Dirty state toggles appropriately on changes
- ✅ Autosave and backup functionality works
- ✅ Close prompts appear when unsaved changes exist
- ✅ No regressions in editor lifecycle management

## Implementation Tasks

### Task 1: Create Minimal Model Interface
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/model/`

Create the core interfaces and types:

```typescript
// IPositronNotebookModel.ts
export interface IPositronNotebookModel {
    readonly uri: URI;
    readonly cells: ReadonlyArray<IPositronCell>;
    readonly metadata: NotebookMetadata;
    readonly isDirty: boolean;
    
    // Events
    readonly onDidChangeContent: Event<NotebookContentChangeEvent>;
    readonly onDidChangeDirty: Event<void>;
    
    // Basic operations for spike
    addCell(type: 'code' | 'markdown', content: string, index?: number): IPositronCell;
    removeCell(cellId: string): boolean;
    updateCellContent(cellId: string, content: string): boolean;
    
    // Serialization for working copy
    serialize(): NotebookData;
    deserialize(data: NotebookData): void;
}

// PositronCell.ts
export interface IPositronCell {
    readonly id: string;
    readonly type: 'code' | 'markdown';
    content: string;
    outputs: IOutputDto[];
    metadata: Record<string, any>;
}

export class PositronCell implements IPositronCell {
    private _id: string;
    private _type: 'code' | 'markdown';
    private _content: string;
    private _outputs: IOutputDto[] = [];
    private _metadata: Record<string, any> = {};
    
    constructor(
        type: 'code' | 'markdown',
        content: string,
        metadata?: Record<string, any>
    ) {
        this._id = generateCellId(); // Use VS Code's UUID utilities
        this._type = type;
        this._content = content;
        this._metadata = metadata || {};
    }
    
    // Getters and setters...
}
```

### Task 2: Implement Basic Model Operations
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/model/positronNotebookModel.ts`

```typescript
export class PositronNotebookModel implements IPositronNotebookModel {
    private _cells: PositronCell[] = [];
    private _metadata: NotebookMetadata = {};
    private _isDirty = false;
    
    private readonly _onDidChangeContent = new Emitter<NotebookContentChangeEvent>();
    readonly onDidChangeContent = this._onDidChangeContent.event;
    
    private readonly _onDidChangeDirty = new Emitter<void>();
    readonly onDidChangeDirty = this._onDidChangeDirty.event;
    
    constructor(
        public readonly uri: URI,
        initialData?: NotebookData
    ) {
        if (initialData) {
            this.deserialize(initialData);
        }
    }
    
    addCell(type: 'code' | 'markdown', content: string, index?: number): IPositronCell {
        const cell = new PositronCell(type, content);
        const insertIndex = index ?? this._cells.length;
        
        this._cells.splice(insertIndex, 0, cell);
        
        this._setDirty(true);
        this._onDidChangeContent.fire({
            type: 'cellAdded',
            cellId: cell.id,
            index: insertIndex
        });
        
        return cell;
    }
    
    removeCell(cellId: string): boolean {
        const index = this._cells.findIndex(c => c.id === cellId);
        if (index === -1) return false;
        
        this._cells.splice(index, 1);
        
        this._setDirty(true);
        this._onDidChangeContent.fire({
            type: 'cellRemoved',
            cellId,
            index
        });
        
        return true;
    }
    
    private _setDirty(dirty: boolean): void {
        if (this._isDirty !== dirty) {
            this._isDirty = dirty;
            this._onDidChangeDirty.fire();
        }
    }
}
```

### Task 3: Create Working Copy Adapter
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/model/positronNotebookWorkingCopyAdapter.ts`

This is the most critical part - bridging our model with VS Code's save system:

```typescript
export class PositronNotebookWorkingCopyAdapter extends Disposable {
    private readonly _workingCopyService: IWorkingCopyService;
    private readonly _workingCopyBackupService: IWorkingCopyBackupService;
    private _workingCopy: IWorkingCopy | undefined;
    
    constructor(
        private readonly model: IPositronNotebookModel,
        @IWorkingCopyService workingCopyService: IWorkingCopyService,
        @IWorkingCopyBackupService workingCopyBackupService: IWorkingCopyBackupService
    ) {
        super();
        
        this._workingCopyService = workingCopyService;
        this._workingCopyBackupService = workingCopyBackupService;
        
        this._initializeWorkingCopy();
        this._registerListeners();
    }
    
    private _initializeWorkingCopy(): void {
        // Create a working copy that VS Code can track
        this._workingCopy = {
            resource: this.model.uri,
            name: basename(this.model.uri),
            capabilities: WorkingCopyCapabilities.None,
            
            isDirty: () => this.model.isDirty,
            
            save: async (options?: ISaveOptions) => {
                // Serialize model to NotebookData
                const data = this.model.serialize();
                
                // Use existing ipynb serializer
                const serializer = await this._getSerializer();
                const bytes = await serializer.notebookToData(data);
                
                // Write to file system
                await this._fileService.writeFile(this.model.uri, bytes);
                
                // Clear dirty flag
                this.model.setDirty(false);
                
                return { success: true };
            },
            
            backup: async (token: CancellationToken) => {
                // Implement backup for hot-exit
                const data = this.model.serialize();
                const serializer = await this._getSerializer();
                const bytes = await serializer.notebookToData(data);
                
                const backup = await this._workingCopyBackupService.backup(
                    this.model.uri,
                    bytes,
                    token
                );
                
                return backup;
            },
            
            revert: async () => {
                // Reload from disk
                const fileContent = await this._fileService.readFile(this.model.uri);
                const serializer = await this._getSerializer();
                const data = await serializer.dataToNotebook(fileContent.value);
                
                this.model.deserialize(data);
                this.model.setDirty(false);
            }
        };
        
        // Register with working copy service
        this._workingCopyService.registerWorkingCopy(this._workingCopy);
    }
    
    private _registerListeners(): void {
        // Forward model dirty changes to working copy service
        this._register(this.model.onDidChangeDirty(() => {
            if (this._workingCopy) {
                this._workingCopyService._onDidChangeDirty.fire(this._workingCopy);
            }
        }));
        
        // Forward content changes for auto-save triggers
        this._register(this.model.onDidChangeContent(() => {
            if (this._workingCopy) {
                this._workingCopyService._onDidChangeContent.fire(this._workingCopy);
            }
        }));
    }
}
```

### Task 4: Wire Up UI Adapter in PositronNotebookInstance
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts`

Modify the existing instance to use the new model (around line 683):

```typescript
// Add feature flag check
private async _initializeModel(): Promise<void> {
    if (this._configService.getValue('positron.notebook.useIntegrationSpike')) {
        // NEW: Use Positron model for spike
        await this._initializePositronModel();
    } else {
        // EXISTING: Use VS Code model
        await this._initializeVSCodeModel();
    }
}

private async _initializePositronModel(): Promise<void> {
    // Load initial data
    const fileContent = await this._fileService.readFile(this.uri);
    const serializer = await this._getSerializer();
    const notebookData = await serializer.dataToNotebook(fileContent.value);
    
    // Create new model
    this._positronModel = new PositronNotebookModel(this.uri, notebookData);
    
    // Set up working copy adapter
    this._workingCopyAdapter = new PositronNotebookWorkingCopyAdapter(
        this._positronModel,
        this._workingCopyService,
        this._workingCopyBackupService
    );
    
    // Wire up cell rendering (minimal for spike)
    this._syncCellsFromPositronModel();
    
    // Listen for changes
    this._register(this._positronModel.onDidChangeContent(() => {
        this._syncCellsFromPositronModel();
    }));
}

private _syncCellsFromPositronModel(): void {
    // Convert PositronCells to UI format
    const uiCells = this._positronModel.cells.map(cell => {
        // Create wrapper that UI expects
        return new PositronNotebookCellWrapper(cell, this._positronModel);
    });
    
    // Update UI
    this._updateRenderedCells(uiCells);
}
```

### Task 5: Minimal Runtime Attachment
**Location**: Same file, add runtime connection

```typescript
private async _attachToRuntime(): Promise<void> {
    // Don't replace kernel UI, just verify we can attach
    const runtimeService = this._runtimeSessionService;
    
    // Check if session exists for this notebook
    let session = runtimeService.getNotebookSessionForNotebookUri(this.uri);
    
    if (!session) {
        // For spike: just log that we would create a session
        console.log('[Integration Spike] Would create runtime session for:', this.uri.toString());
        
        // Verify we can access the service
        const availableRuntimes = await runtimeService.getStartableRuntimes();
        console.log('[Integration Spike] Available runtimes:', availableRuntimes.length);
    } else {
        console.log('[Integration Spike] Found existing session:', session.sessionId);
    }
    
    // Don't actually execute anything in spike
}
```

## Testing & Validation

### Manual Testing Checklist
1. **Open notebook file**
   - [ ] File loads correctly
   - [ ] Cells display in UI
   - [ ] Metadata preserved

2. **Edit operations**
   - [ ] Add new cell
   - [ ] Remove cell
   - [ ] Edit cell content
   - [ ] Dirty indicator appears

3. **Save operations**
   - [ ] Manual save (Cmd+S)
   - [ ] Auto-save triggers
   - [ ] File content correct after save

4. **Working copy features**
   - [ ] Unsaved changes prompt on close
   - [ ] Hot-exit backup created
   - [ ] Restore after crash

5. **Runtime verification**
   - [ ] Console logs show runtime access
   - [ ] No errors in kernel UI

### Automated Tests
Create basic smoke tests:

```typescript
// positronNotebookModel.test.ts
suite('PositronNotebookModel - Integration Spike', () => {
    test('creates model with cells', () => {
        const model = new PositronNotebookModel(URI.parse('file:///test.ipynb'));
        const cell = model.addCell('code', 'print("hello")');
        
        assert.strictEqual(model.cells.length, 1);
        assert.strictEqual(cell.content, 'print("hello")');
    });
    
    test('tracks dirty state', () => {
        const model = new PositronNotebookModel(URI.parse('file:///test.ipynb'));
        assert.strictEqual(model.isDirty, false);
        
        model.addCell('code', 'test');
        assert.strictEqual(model.isDirty, true);
    });
    
    test('serializes to NotebookData', () => {
        const model = new PositronNotebookModel(URI.parse('file:///test.ipynb'));
        model.addCell('code', 'print(1)');
        model.addCell('markdown', '# Header');
        
        const data = model.serialize();
        assert.strictEqual(data.cells.length, 2);
        assert.strictEqual(data.cells[0].cellKind, CellKind.Code);
    });
});
```

## Exit Criteria

### Must Have (Spike Success)
- ✅ Cells render from new model
- ✅ Dirty state works correctly
- ✅ Save/backup functional
- ✅ No editor lifecycle regressions

### Nice to Have (Bonus)
- Cell selection tracking
- Basic move operation
- Metadata preservation verified

## Known Limitations (Acceptable for Spike)
- No execution functionality
- No undo/redo
- No complex cell operations
- No output rendering
- Minimal error handling

## Risk Mitigation

### High Risk Areas
1. **Working Copy Integration**: Most complex part, budget extra time
2. **Event Shape Mismatch**: UI might expect different event formats
3. **Serializer Compatibility**: ipynb format edge cases

### Mitigation Strategies
- Start with working copy integration first (fail fast)
- Use extensive logging during spike
- Keep VS Code model as fallback
- Document all discovered requirements

## Feature Flag Configuration

Add to settings:
```json
{
  "positron.notebook.useIntegrationSpike": {
    "type": "boolean", 
    "default": false,
    "description": "Use integration spike notebook model (development only)"
  }
}
```

## Next Steps After Spike

Based on spike results:
1. Document any discovered API incompatibilities
2. Refine estimates for subsequent phases
3. Identify additional adapter requirements
4. Plan detailed Phase 1 implementation

## Code Locations Reference

Key files to modify/create:
- `/src/vs/workbench/contrib/positronNotebook/browser/model/IPositronNotebookModel.ts` (new)
- `/src/vs/workbench/contrib/positronNotebook/browser/model/positronNotebookModel.ts` (new)
- `/src/vs/workbench/contrib/positronNotebook/browser/model/positronCell.ts` (new)
- `/src/vs/workbench/contrib/positronNotebook/browser/model/positronNotebookWorkingCopyAdapter.ts` (new)
- `/src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts` (modify)
- `/src/vs/workbench/contrib/positronNotebook/browser/positronNotebookExperimentalConfig.ts` (modify)

## Dependencies

Required VS Code services:
- `IWorkingCopyService`
- `IWorkingCopyBackupService`
- `IFileService`
- `IConfigurationService`
- `IRuntimeSessionService`
- `INotebookSerializer`

## Time Budget

- **Week 1**: Working copy integration, basic model
- **Week 2**: UI adapter, testing, documentation
- **Buffer**: 2-3 days for discovered issues

This spike provides the foundation for all subsequent phases. Success here validates the entire architectural approach.