# Phase 4: File I/O & Persistence - Positron Notebook Model
## Timeline: Weeks 10-11

## Executive Summary
Implement comprehensive file I/O and persistence layer with focus on the complex working copy adapter. This phase handles save, backup, hot-exit, and serialization while bridging between our simplified model and VS Code's working copy expectations.

## Prerequisites
- Phase 1 (Core Model) completed
- Understanding of IWorkingCopyService
- NotebookFileWorkingCopyModel complexity
- ipynb serializer edge cases

## Background Context

### Critical Complexity Warning
The technical review identified this as HIGH RISK:
- `NotebookFileWorkingCopyModel` expects specific event shapes from `NotebookTextModel`
- The ipynb serializer handles 500+ lines of edge cases
- Event mapping between models is non-trivial
- Working copy lifecycle has implicit dependencies

### Architecture Challenge
```
PositronNotebookModel → WorkingCopyAdapter → IWorkingCopyService
                    ↓                     ↓
            Event Translation      Save/Backup/Hot-exit
                    ↓
            NotebookSerializer → .ipynb file
```

## Implementation Tasks

### Task 1: Working Copy Adapter - Complex Bridge
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/workingCopy/positronNotebookWorkingCopyAdapter.ts`

```typescript
/**
 * CRITICAL: This adapter bridges between PositronNotebookModel events
 * and what NotebookFileWorkingCopyModel expects from NotebookTextModel.
 * This is the most complex part of the integration.
 */
export class PositronNotebookWorkingCopyAdapter extends Disposable implements IWorkingCopy {
    private readonly _onDidChangeDirty = this._register(new Emitter<void>());
    readonly onDidChangeDirty = this._onDidChangeDirty.event;
    
    private readonly _onDidChangeContent = this._register(new Emitter<void>());
    readonly onDidChangeContent = this._onDidChangeContent.event;
    
    private readonly _onDidSave = this._register(new Emitter<IWorkingCopySaveEvent>());
    readonly onDidSave = this._onDidSave.event;
    
    private _workingCopyModel: NotebookFileWorkingCopyModel | undefined;
    private _lastSavedVersionId = 0;
    private _backupResource: URI | undefined;
    
    readonly capabilities = WorkingCopyCapabilities.None;
    readonly name: string;
    readonly resource: URI;
    readonly typeId = 'notebook';
    
    constructor(
        private readonly model: IPositronNotebookModel,
        @IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
        @IWorkingCopyBackupService private readonly backupService: IWorkingCopyBackupService,
        @IFileService private readonly fileService: IFileService,
        @INotebookSerializer private readonly serializer: INotebookSerializer,
        @ILogService private readonly logService: ILogService,
        @ITextFileService private readonly textFileService: ITextFileService
    ) {
        super();
        
        this.resource = model.uri;
        this.name = basename(model.uri);
        
        this._initializeAdapter();
        this._registerModelListeners();
        this._registerWithWorkingCopyService();
    }
    
    private _initializeAdapter(): void {
        // Create the complex NotebookFileWorkingCopyModel wrapper
        // This is necessary because many VS Code services expect this specific type
        try {
            // We need to create a "fake" NotebookTextModel-like interface
            const modelProxy = this._createModelProxy();
            
            this._workingCopyModel = new NotebookFileWorkingCopyModel(
                this.resource,
                this.name,
                modelProxy as any, // Type assertion necessary due to interface mismatch
                this.serializer,
                this.fileService,
                this.backupService,
                this.logService
            );
            
        } catch (error) {
            this.logService.error('Failed to create working copy model:', error);
            // Fall back to direct implementation
            this._setupDirectImplementation();
        }
    }
    
    private _createModelProxy(): any {
        // Create a proxy that looks like NotebookTextModel to NotebookFileWorkingCopyModel
        // This is the critical bridge that took 500+ lines in the original
        
        return {
            // Required NotebookTextModel interface
            uri: this.model.uri,
            viewType: this.model.viewType,
            
            // Version tracking
            versionId: this.model.versionId,
            alternativeVersionId: this.model.versionId,
            
            // Cell access - map our cells to expected format
            get cells() {
                return this._mapCellsToTextModel(this.model.cells);
            },
            
            get length() {
                return this.model.cells.length;
            },
            
            // Metadata
            metadata: this.model.metadata,
            
            // Events - Critical: must match NotebookTextModel event signatures
            onDidChangeContent: this._createContentChangeEventProxy(),
            onDidChangeDirty: this.model.onDidChangeDirty,
            onWillDispose: this.model.onWillDispose,
            
            // Operations - Map to our direct API
            applyEdits: (edits: any[], synchronous: boolean) => {
                return this._applyEditsProxy(edits, synchronous);
            },
            
            // Serialization
            serialize: () => this.model.serialize(),
            
            // Snapshot for backup
            createSnapshot: () => {
                return this._createSnapshot();
            },
            
            // Required but unused methods
            deltaCellStatusBarItems: () => {},
            transientOptions: {},
            
            // Disposal
            isDisposed: () => this.model.isDisposed(),
            dispose: () => this.model.dispose()
        };
    }
    
    private _mapCellsToTextModel(cells: ReadonlyArray<IPositronCell>): any[] {
        // Map our cells to NotebookCellTextModel-like format
        return cells.map(cell => ({
            handle: cell.handle,
            uri: URI.from({ scheme: 'vscode-notebook-cell', path: `${this.resource}#${cell.id}` }),
            cellKind: cell.type === 'code' ? CellKind.Code : CellKind.Markup,
            
            // Text model interface
            getValue: () => cell.content,
            getTextLength: () => cell.content.length,
            
            // Language
            language: cell.type === 'code' ? 'python' : 'markdown', // TODO: Get from metadata
            
            // Outputs
            outputs: cell.outputs,
            
            // Metadata
            metadata: cell.metadata,
            internalMetadata: {},
            
            // Events
            onDidChangeContent: cell.onDidChangeContent,
            onDidChangeOutputs: cell.onDidChangeOutputs,
            onDidChangeMetadata: cell.onDidChangeMetadata,
            
            // Version
            textVersionId: this.model.versionId
        }));
    }
    
    private _createContentChangeEventProxy(): Event<any> {
        // Transform our events to match NotebookTextModel's ContentChangeEvent
        return Event.map(this.model.onDidChangeContent, (e) => {
            // Map our simple event to complex NotebookTextModelChangedEvent
            return {
                rawEvents: [{
                    kind: this._mapEventType(e.type),
                    index: e.index,
                    count: 1,
                    cells: e.cellId ? [this._getCellProxy(e.cellId)] : []
                }],
                versionId: this.model.versionId,
                synchronous: true,
                endSelectionState: undefined
            };
        });
    }
    
    private _mapEventType(type: string): NotebookCellsChangeType {
        switch (type) {
            case 'cellAdded': return NotebookCellsChangeType.ModelChange;
            case 'cellRemoved': return NotebookCellsChangeType.ModelChange;
            case 'cellMoved': return NotebookCellsChangeType.Move;
            case 'contentChanged': return NotebookCellsChangeType.ChangeCellContent;
            case 'outputsChanged': return NotebookCellsChangeType.Output;
            case 'metadataChanged': return NotebookCellsChangeType.ChangeCellMetadata;
            default: return NotebookCellsChangeType.Unknown;
        }
    }
    
    private _applyEditsProxy(edits: any[], synchronous: boolean): any {
        // Translate NotebookTextModel edits to our direct API calls
        const results = [];
        
        for (const edit of edits) {
            try {
                const result = this._applyEdit(edit);
                results.push(result);
            } catch (error) {
                this.logService.error('Failed to apply edit:', error);
                results.push(null);
            }
        }
        
        return {
            reverseEdits: [], // We handle undo/redo differently
            cells: results
        };
    }
    
    private _applyEdit(edit: any): any {
        switch (edit.editType) {
            case CellEditType.Replace: {
                // Remove old cells
                for (let i = 0; i < edit.count; i++) {
                    const cell = this.model.cells[edit.index];
                    if (cell) {
                        this.model.removeCell(cell.id);
                    }
                }
                
                // Add new cells
                const newCells = [];
                for (const cellData of edit.cells) {
                    const cell = this.model.addCell(
                        cellData.cellKind === CellKind.Code ? 'code' : 'markdown',
                        cellData.source,
                        edit.index,
                        cellData.metadata
                    );
                    newCells.push(cell);
                }
                
                return newCells;
            }
            
            case CellEditType.Move: {
                const cell = this.model.cells[edit.index];
                if (cell) {
                    this.model.moveCell(cell.id, edit.newIdx);
                }
                return cell;
            }
            
            default:
                throw new Error(`Unknown edit type: ${edit.editType}`);
        }
    }
    
    // IWorkingCopy Implementation
    isDirty(): boolean {
        return this.model.isDirty;
    }
    
    async save(options?: ISaveOptions): Promise<boolean> {
        try {
            // Serialize to NotebookData
            const data = this.model.serialize();
            
            // Use the serializer to convert to bytes
            const bytes = await this.serializer.notebookToData(data);
            
            // Write to file
            await this.fileService.writeFile(this.resource, bytes);
            
            // Update saved version
            this._lastSavedVersionId = this.model.versionId;
            
            // Clear dirty flag
            this.model['_setDirty'](false);
            
            // Fire save event
            this._onDidSave.fire({
                reason: options?.reason,
                source: options?.source
            });
            
            return true;
            
        } catch (error) {
            this.logService.error('Failed to save notebook:', error);
            throw error;
        }
    }
    
    async backup(token: CancellationToken): Promise<IWorkingCopyBackup> {
        const data = this.model.serialize();
        const bytes = await this.serializer.notebookToData(data);
        
        // Store backup
        const backup = await this.backupService.backup(this.resource, bytes, token);
        this._backupResource = backup.resource;
        
        return backup;
    }
    
    async revert(options?: IRevertOptions): Promise<void> {
        try {
            // Read file content
            const content = await this.fileService.readFile(this.resource);
            
            // Deserialize
            const data = await this.serializer.dataToNotebook(content.value);
            
            // Update model
            this.model.deserialize(data);
            
            // Clear dirty flag
            this.model['_setDirty'](false);
            
            // Update version
            this._lastSavedVersionId = this.model.versionId;
            
        } catch (error) {
            this.logService.error('Failed to revert notebook:', error);
            throw error;
        }
    }
    
    private _createSnapshot(): VSBufferReadableStream {
        const data = this.model.serialize();
        const bytes = this.serializer.notebookToData(data);
        
        return bufferToStream(bytes);
    }
    
    private _registerWithWorkingCopyService(): void {
        this.workingCopyService.registerWorkingCopy(this);
    }
    
    override dispose(): void {
        this.workingCopyService.unregisterWorkingCopy(this);
        this._workingCopyModel?.dispose();
        super.dispose();
    }
}
```

### Task 2: Model Resolution Service
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/services/positronNotebookModelResolver.ts`

```typescript
export interface IPositronNotebookModelResolver {
    resolve(resource: URI): Promise<IPositronNotebookModel>;
    createUntitled(viewType: string): Promise<IPositronNotebookModel>;
}

@registerSingleton(IPositronNotebookModelResolver, PositronNotebookModelResolver)
export class PositronNotebookModelResolver extends Disposable implements IPositronNotebookModelResolver {
    private readonly _models = new ResourceMap<IPositronNotebookModel>();
    private readonly _pendingResolves = new ResourceMap<Promise<IPositronNotebookModel>>();
    
    constructor(
        @IFileService private readonly fileService: IFileService,
        @INotebookSerializer private readonly serializer: INotebookSerializer,
        @IInstantiationService private readonly instantiationService: IInstantiationService,
        @IWorkingCopyService private readonly workingCopyService: IWorkingCopyService
    ) {
        super();
        
        this._registerListeners();
    }
    
    async resolve(resource: URI): Promise<IPositronNotebookModel> {
        // Check cache
        const existing = this._models.get(resource);
        if (existing && !existing.isDisposed()) {
            return existing;
        }
        
        // Check pending
        const pending = this._pendingResolves.get(resource);
        if (pending) {
            return pending;
        }
        
        // Start resolution
        const promise = this._doResolve(resource);
        this._pendingResolves.set(resource, promise);
        
        try {
            const model = await promise;
            this._models.set(resource, model);
            return model;
        } finally {
            this._pendingResolves.delete(resource);
        }
    }
    
    private async _doResolve(resource: URI): Promise<IPositronNotebookModel> {
        // Read file
        const content = await this.fileService.readFile(resource);
        
        // Deserialize
        const data = await this.serializer.dataToNotebook(content.value);
        
        // Create model
        const model = this.instantiationService.createInstance(
            PositronNotebookModel,
            resource,
            'jupyter-notebook',
            { initialData: data }
        );
        
        // Create working copy adapter
        const adapter = this.instantiationService.createInstance(
            PositronNotebookWorkingCopyAdapter,
            model
        );
        
        // Track disposal
        model.onWillDispose(() => {
            this._models.delete(resource);
            adapter.dispose();
        });
        
        return model;
    }
    
    async createUntitled(viewType: string): Promise<IPositronNotebookModel> {
        const resource = URI.from({
            scheme: Schemas.untitled,
            path: `Untitled-${Date.now()}.ipynb`
        });
        
        // Create empty model
        const model = this.instantiationService.createInstance(
            PositronNotebookModel,
            resource,
            viewType
        );
        
        // Add default cell
        model.addCell('code', '');
        
        // Create working copy adapter
        const adapter = this.instantiationService.createInstance(
            PositronNotebookWorkingCopyAdapter,
            model
        );
        
        this._models.set(resource, model);
        
        return model;
    }
    
    private _registerListeners(): void {
        // Clean up on file deletion
        this._register(this.fileService.onDidFilesChange(e => {
            for (const change of e.changes) {
                if (change.type === FileChangeType.DELETED) {
                    const model = this._models.get(change.resource);
                    if (model) {
                        model.dispose();
                    }
                }
            }
        }));
    }
}
```

### Task 3: Serializer Integration
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/services/positronNotebookSerializer.ts`

```typescript
/**
 * Wrapper around the existing ipynb serializer to handle our model format.
 * The existing serializer has 500+ lines of edge case handling we want to reuse.
 */
export class PositronNotebookSerializerWrapper {
    constructor(
        private readonly baseSerializer: INotebookSerializer
    ) {}
    
    async serializeNotebook(model: IPositronNotebookModel): Promise<VSBuffer> {
        // Convert to NotebookData format expected by serializer
        const notebookData = this._convertToNotebookData(model);
        
        // Use existing serializer
        return this.baseSerializer.notebookToData(notebookData);
    }
    
    async deserializeNotebook(content: VSBuffer): Promise<NotebookData> {
        // Use existing deserializer
        return this.baseSerializer.dataToNotebook(content);
    }
    
    private _convertToNotebookData(model: IPositronNotebookModel): NotebookData {
        return {
            cells: model.cells.map(cell => this._convertCell(cell)),
            metadata: this._convertMetadata(model.metadata)
        };
    }
    
    private _convertCell(cell: IPositronCell): ICellDto {
        return {
            cellKind: cell.type === 'code' ? CellKind.Code : CellKind.Markup,
            source: cell.content,
            language: cell.type === 'code' ? 'python' : 'markdown',
            outputs: this._convertOutputs(cell.outputs),
            metadata: cell.metadata,
            internalMetadata: {}
        };
    }
    
    private _convertOutputs(outputs: IPositronCellOutput[]): IOutputDto[] {
        // Handle complex output format conversions
        return outputs.map(output => ({
            outputId: output.outputId,
            outputs: output.outputs.map(item => ({
                mime: item.mime,
                data: this._encodeOutputData(item.data, item.mime)
            })),
            metadata: output.metadata
        }));
    }
    
    private _encodeOutputData(data: any, mime: string): any {
        // Handle special encoding for different mime types
        if (mime.startsWith('image/')) {
            // Base64 encode if needed
            if (typeof data === 'string') {
                return data;
            }
            return btoa(String.fromCharCode(...new Uint8Array(data)));
        }
        
        return data;
    }
    
    private _convertMetadata(metadata: IPositronNotebookMetadata): any {
        // Ensure required fields for ipynb format
        return {
            ...metadata,
            nbformat: metadata.nbformat || 4,
            nbformat_minor: metadata.nbformat_minor || 4
        };
    }
}
```

## Testing Requirements

### Critical Test Cases
```typescript
suite('PositronNotebookWorkingCopyAdapter - Critical', () => {
    test('maps events correctly to NotebookTextModel format', async () => {
        const model = createTestModel();
        const adapter = new PositronNotebookWorkingCopyAdapter(model);
        
        const events = [];
        adapter['_workingCopyModel'].onDidChangeContent(e => events.push(e));
        
        // Add cell through our API
        model.addCell('code', 'test');
        
        // Verify event shape matches NotebookTextModel
        assert.ok(events[0].rawEvents);
        assert.strictEqual(events[0].rawEvents[0].kind, NotebookCellsChangeType.ModelChange);
    });
    
    test('handles save with ipynb serialization', async () => {
        const model = createTestModel();
        model.addCell('code', 'print("test")');
        model.addCell('markdown', '# Header');
        
        const adapter = new PositronNotebookWorkingCopyAdapter(model);
        
        await adapter.save();
        
        // Read saved file
        const content = await fileService.readFile(model.uri);
        const data = JSON.parse(content.toString());
        
        // Verify ipynb format
        assert.strictEqual(data.nbformat, 4);
        assert.strictEqual(data.cells.length, 2);
        assert.strictEqual(data.cells[0].cell_type, 'code');
    });
    
    test('handles backup and restore', async () => {
        const model = createTestModel();
        model.addCell('code', 'original');
        
        const adapter = new PositronNotebookWorkingCopyAdapter(model);
        
        // Create backup
        await adapter.backup(CancellationToken.None);
        
        // Modify model
        model.updateCellContent(model.cells[0].id, 'modified');
        
        // Restore from backup
        await adapter.revert();
        
        assert.strictEqual(model.cells[0].content, 'original');
    });
    
    test('handles complex output serialization', async () => {
        const model = createTestModel();
        const cell = model.addCell('code', 'test');
        
        // Add complex outputs
        model.updateCellOutputs(cell.id, [{
            outputId: 'test-1',
            outputs: [
                { mime: 'text/plain', data: 'Hello' },
                { mime: 'text/html', data: '<b>Hello</b>' },
                { mime: 'image/png', data: 'base64data...' }
            ]
        }]);
        
        const adapter = new PositronNotebookWorkingCopyAdapter(model);
        await adapter.save();
        
        // Verify outputs preserved
        const content = await fileService.readFile(model.uri);
        const data = JSON.parse(content.toString());
        
        assert.strictEqual(data.cells[0].outputs.length, 1);
        assert.ok(data.cells[0].outputs[0]['text/plain']);
    });
});
```

## Risk Mitigation

### High Risk: Working Copy Event Mismatch
**Mitigation**: Extensive event proxy layer with logging

### High Risk: Serializer Edge Cases  
**Mitigation**: Reuse existing serializer, comprehensive test suite

### Medium Risk: Backup/Restore Failures
**Mitigation**: Fallback to file system state, user notifications

## Success Criteria
- ✅ Save/load preserves all notebook data
- ✅ Backup/hot-exit works correctly
- ✅ Working copy dirty state accurate
- ✅ Auto-save functions properly
- ✅ Large notebooks handled efficiently
- ✅ All ipynb format variations supported

## Next Phase Dependencies
Enables:
- Phase 5: Undo/redo (needs save points)
- Phase 6: UI integration (save indicators)
- Phase 8: Migration (file format compatibility)