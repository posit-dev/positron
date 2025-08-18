# Phase 1: Core Model Implementation - Positron Notebook Model
## Timeline: Weeks 2-4

## Executive Summary
Build the complete core notebook model with all fundamental cell operations, robust event system, and proper TypeScript interfaces. This phase transforms the integration spike proof-of-concept into production-ready code with comprehensive test coverage and error handling.

## Prerequisites
- Phase 0 (Integration Spike) completed successfully
- Working copy integration validated
- UI adapter pattern proven
- Basic cell rendering functional

## Background Context

### Architecture Overview
The core model is the foundation of our simplified notebook system. Unlike VS Code's operation-based approach, we use direct method calls:

**VS Code Pattern (Complex)**:
```typescript
// Every change goes through operations
const edits = [{ editType: CellEditType.Replace, index: 0, count: 1, cells: [...] }];
textModel.applyEdits(edits, true, selectionState, () => newSelection);
```

**Positron Pattern (Simple)**:
```typescript
// Direct, intuitive API
const cell = model.addCell('code', 'print("hello")', 0);
model.updateCellContent(cell.id, 'print("world")');
```

### Design Principles
1. **Simplicity**: Direct methods instead of operations
2. **Type Safety**: Full TypeScript with strict mode
3. **Performance**: O(1) cell lookups via Map
4. **Observability**: Granular events for every change
5. **Immutability**: Cells are immutable externally

## Implementation Tasks

### Task 1: Complete Model Structure
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/model/`

#### 1.1 Enhanced Type Definitions
```typescript
// positronNotebookTypes.ts
export enum PositronCellKind {
    Code = 1,
    Markdown = 2
}

export interface IPositronCellOutput {
    outputId: string;
    outputs: IOutputDto[];
    metadata?: Record<string, any>;
}

export interface IPositronCellMetadata {
    collapsed?: boolean;
    scrolled?: boolean;
    tags?: string[];
    [key: string]: any;
}

export interface IPositronNotebookMetadata {
    kernelspec?: {
        name: string;
        display_name: string;
        language: string;
    };
    language_info?: {
        name: string;
        version?: string;
    };
    orig_nbformat?: number;
    [key: string]: any;
}

export interface NotebookContentChangeEvent {
    readonly type: 'cellAdded' | 'cellRemoved' | 'cellMoved' | 'contentChanged' | 'outputsChanged' | 'metadataChanged';
    readonly cellId?: string;
    readonly index?: number;
    readonly newIndex?: number;
    readonly source?: string;
}

export interface IPositronNotebookModelOptions {
    readonly uri: URI;
    readonly viewType: string;
    readonly metadata?: IPositronNotebookMetadata;
    readonly transientOptions?: {
        transientCellMetadata?: Record<string, boolean>;
        transientDocumentMetadata?: Record<string, boolean>;
        transientOutputs?: boolean;
    };
}
```

#### 1.2 Complete Cell Implementation
```typescript
// positronCell.ts
export class PositronCell implements IPositronCell {
    private static _cellIdCounter = 0;
    
    private readonly _id: string;
    private readonly _handle: number;
    private _type: PositronCellKind;
    private _content: string;
    private _outputs: IPositronCellOutput[] = [];
    private _metadata: IPositronCellMetadata;
    private _internalMetadata: Record<string, any> = {};
    
    private readonly _onDidChangeContent = new Emitter<string>();
    readonly onDidChangeContent = this._onDidChangeContent.event;
    
    private readonly _onDidChangeOutputs = new Emitter<IPositronCellOutput[]>();
    readonly onDidChangeOutputs = this._onDidChangeOutputs.event;
    
    private readonly _onDidChangeMetadata = new Emitter<IPositronCellMetadata>();
    readonly onDidChangeMetadata = this._onDidChangeMetadata.event;
    
    constructor(
        type: PositronCellKind,
        content: string,
        metadata?: IPositronCellMetadata
    ) {
        this._id = `positron-cell-${Date.now()}-${PositronCell._cellIdCounter++}`;
        this._handle = PositronCell._cellIdCounter;
        this._type = type;
        this._content = content;
        this._metadata = metadata || {};
    }
    
    get id(): string { return this._id; }
    get handle(): number { return this._handle; }
    get type(): PositronCellKind { return this._type; }
    get content(): string { return this._content; }
    get outputs(): ReadonlyArray<IPositronCellOutput> { return this._outputs; }
    get metadata(): Readonly<IPositronCellMetadata> { return this._metadata; }
    
    updateContent(content: string): void {
        if (this._content !== content) {
            this._content = content;
            this._onDidChangeContent.fire(content);
        }
    }
    
    updateOutputs(outputs: IPositronCellOutput[]): void {
        this._outputs = outputs;
        this._onDidChangeOutputs.fire(outputs);
    }
    
    appendOutput(output: IPositronCellOutput): void {
        this._outputs.push(output);
        this._onDidChangeOutputs.fire(this._outputs);
    }
    
    clearOutputs(): void {
        if (this._outputs.length > 0) {
            this._outputs = [];
            this._onDidChangeOutputs.fire(this._outputs);
        }
    }
    
    updateMetadata(metadata: Partial<IPositronCellMetadata>): void {
        this._metadata = { ...this._metadata, ...metadata };
        this._onDidChangeMetadata.fire(this._metadata);
    }
    
    clone(): PositronCell {
        const clone = new PositronCell(this._type, this._content, { ...this._metadata });
        clone._outputs = this._outputs.map(o => ({ ...o }));
        clone._internalMetadata = { ...this._internalMetadata };
        return clone;
    }
    
    dispose(): void {
        this._onDidChangeContent.dispose();
        this._onDidChangeOutputs.dispose();
        this._onDidChangeMetadata.dispose();
    }
}
```

### Task 2: Full Model Implementation
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/model/positronNotebookModel.ts`

```typescript
export class PositronNotebookModel extends Disposable implements IPositronNotebookModel {
    private readonly _cells: PositronCell[] = [];
    private readonly _cellMap = new Map<string, PositronCell>(); // O(1) lookups
    private _metadata: IPositronNotebookMetadata;
    private _isDirty = false;
    private _versionId = 0;
    
    // Events
    private readonly _onDidChangeContent = this._register(new Emitter<NotebookContentChangeEvent>());
    readonly onDidChangeContent = this._onDidChangeContent.event;
    
    private readonly _onDidChangeDirty = this._register(new Emitter<void>());
    readonly onDidChangeDirty = this._onDidChangeDirty.event;
    
    private readonly _onWillDispose = this._register(new Emitter<void>());
    readonly onWillDispose = this._onWillDispose.event;
    
    constructor(
        public readonly uri: URI,
        public readonly viewType: string,
        options?: Partial<IPositronNotebookModelOptions>
    ) {
        super();
        this._metadata = options?.metadata || {};
        
        if (options?.initialData) {
            this.deserialize(options.initialData);
        }
    }
    
    get cells(): ReadonlyArray<PositronCell> {
        return this._cells;
    }
    
    get metadata(): Readonly<IPositronNotebookMetadata> {
        return this._metadata;
    }
    
    get isDirty(): boolean {
        return this._isDirty;
    }
    
    get versionId(): number {
        return this._versionId;
    }
    
    // Core cell operations
    addCell(type: 'code' | 'markdown', content: string, index?: number, metadata?: IPositronCellMetadata): PositronCell {
        const cellType = type === 'code' ? PositronCellKind.Code : PositronCellKind.Markdown;
        const cell = new PositronCell(cellType, content, metadata);
        
        const insertIndex = this._validateIndex(index, this._cells.length);
        this._cells.splice(insertIndex, 0, cell);
        this._cellMap.set(cell.id, cell);
        
        // Set up cell listeners
        this._register(cell.onDidChangeContent(() => {
            this._onCellContentChanged(cell);
        }));
        
        this._register(cell.onDidChangeOutputs(() => {
            this._onCellOutputsChanged(cell);
        }));
        
        this._register(cell.onDidChangeMetadata(() => {
            this._onCellMetadataChanged(cell);
        }));
        
        this._setDirty(true);
        this._incrementVersion();
        this._onDidChangeContent.fire({
            type: 'cellAdded',
            cellId: cell.id,
            index: insertIndex
        });
        
        return cell;
    }
    
    removeCell(cellId: string): boolean {
        const index = this._cells.findIndex(c => c.id === cellId);
        if (index === -1) {
            return false;
        }
        
        const cell = this._cells[index];
        this._cells.splice(index, 1);
        this._cellMap.delete(cellId);
        
        cell.dispose();
        
        this._setDirty(true);
        this._incrementVersion();
        this._onDidChangeContent.fire({
            type: 'cellRemoved',
            cellId,
            index
        });
        
        return true;
    }
    
    moveCell(cellId: string, newIndex: number): boolean {
        const oldIndex = this._cells.findIndex(c => c.id === cellId);
        if (oldIndex === -1) {
            return false;
        }
        
        const validNewIndex = this._validateIndex(newIndex, this._cells.length - 1);
        if (oldIndex === validNewIndex) {
            return false;
        }
        
        const [cell] = this._cells.splice(oldIndex, 1);
        this._cells.splice(validNewIndex, 0, cell);
        
        this._setDirty(true);
        this._incrementVersion();
        this._onDidChangeContent.fire({
            type: 'cellMoved',
            cellId,
            index: oldIndex,
            newIndex: validNewIndex
        });
        
        return true;
    }
    
    updateCellContent(cellId: string, content: string): boolean {
        const cell = this._cellMap.get(cellId);
        if (!cell) {
            return false;
        }
        
        cell.updateContent(content);
        return true;
    }
    
    updateCellOutputs(cellId: string, outputs: IPositronCellOutput[]): boolean {
        const cell = this._cellMap.get(cellId);
        if (!cell) {
            return false;
        }
        
        cell.updateOutputs(outputs);
        return true;
    }
    
    clearCellOutputs(cellId: string): boolean {
        const cell = this._cellMap.get(cellId);
        if (!cell) {
            return false;
        }
        
        cell.clearOutputs();
        return true;
    }
    
    clearAllOutputs(): void {
        let changed = false;
        for (const cell of this._cells) {
            if (cell.outputs.length > 0) {
                cell.clearOutputs();
                changed = true;
            }
        }
        
        if (changed) {
            this._setDirty(true);
            this._incrementVersion();
        }
    }
    
    getCellById(cellId: string): PositronCell | undefined {
        return this._cellMap.get(cellId);
    }
    
    getCellIndex(cellId: string): number {
        return this._cells.findIndex(c => c.id === cellId);
    }
    
    updateMetadata(metadata: Partial<IPositronNotebookMetadata>): void {
        this._metadata = { ...this._metadata, ...metadata };
        this._setDirty(true);
        this._incrementVersion();
        this._onDidChangeContent.fire({
            type: 'metadataChanged'
        });
    }
    
    // Serialization
    serialize(): NotebookData {
        return {
            cells: this._cells.map(cell => this._serializeCell(cell)),
            metadata: this._metadata
        };
    }
    
    deserialize(data: NotebookData): void {
        // Clear existing cells
        for (const cell of this._cells) {
            cell.dispose();
        }
        this._cells.length = 0;
        this._cellMap.clear();
        
        // Load new cells
        for (const cellData of data.cells) {
            const type = cellData.cellKind === CellKind.Code ? 'code' : 'markdown';
            const cell = this.addCell(
                type,
                cellData.source,
                this._cells.length,
                cellData.metadata
            );
            
            if (cellData.outputs) {
                cell.updateOutputs(cellData.outputs);
            }
        }
        
        this._metadata = data.metadata || {};
        this._setDirty(false);
        this._versionId = 0;
    }
    
    // Private helpers
    private _serializeCell(cell: PositronCell): ICellDto {
        return {
            cellKind: cell.type === PositronCellKind.Code ? CellKind.Code : CellKind.Markup,
            source: cell.content,
            outputs: cell.outputs,
            metadata: cell.metadata,
            internalMetadata: {}
        };
    }
    
    private _validateIndex(index: number | undefined, max: number): number {
        if (index === undefined) {
            return max;
        }
        return Math.max(0, Math.min(index, max));
    }
    
    private _setDirty(dirty: boolean): void {
        if (this._isDirty !== dirty) {
            this._isDirty = dirty;
            this._onDidChangeDirty.fire();
        }
    }
    
    private _incrementVersion(): void {
        this._versionId++;
    }
    
    private _onCellContentChanged(cell: PositronCell): void {
        this._setDirty(true);
        this._incrementVersion();
        this._onDidChangeContent.fire({
            type: 'contentChanged',
            cellId: cell.id
        });
    }
    
    private _onCellOutputsChanged(cell: PositronCell): void {
        this._setDirty(true);
        this._incrementVersion();
        this._onDidChangeContent.fire({
            type: 'outputsChanged',
            cellId: cell.id
        });
    }
    
    private _onCellMetadataChanged(cell: PositronCell): void {
        this._setDirty(true);
        this._incrementVersion();
        this._onDidChangeContent.fire({
            type: 'metadataChanged',
            cellId: cell.id
        });
    }
    
    override dispose(): void {
        this._onWillDispose.fire();
        
        for (const cell of this._cells) {
            cell.dispose();
        }
        this._cells.length = 0;
        this._cellMap.clear();
        
        super.dispose();
    }
}
```

### Task 3: Model Factory and Registry
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/model/positronNotebookModelFactory.ts`

```typescript
export interface IPositronNotebookModelFactory {
    createModel(uri: URI, viewType: string, data?: NotebookData): IPositronNotebookModel;
    resolveModel(uri: URI): Promise<IPositronNotebookModel>;
}

@registerSingleton(IPositronNotebookModelFactory, PositronNotebookModelFactory)
export class PositronNotebookModelFactory implements IPositronNotebookModelFactory {
    private readonly _models = new Map<string, IPositronNotebookModel>();
    
    constructor(
        @IFileService private readonly fileService: IFileService,
        @INotebookSerializer private readonly serializer: INotebookSerializer
    ) {}
    
    createModel(uri: URI, viewType: string, data?: NotebookData): IPositronNotebookModel {
        const key = uri.toString();
        
        // Check for existing model
        const existing = this._models.get(key);
        if (existing) {
            return existing;
        }
        
        // Create new model
        const model = new PositronNotebookModel(uri, viewType, {
            initialData: data
        });
        
        this._models.set(key, model);
        
        // Clean up on dispose
        model.onWillDispose(() => {
            this._models.delete(key);
        });
        
        return model;
    }
    
    async resolveModel(uri: URI): Promise<IPositronNotebookModel> {
        const key = uri.toString();
        
        // Check cache
        const existing = this._models.get(key);
        if (existing) {
            return existing;
        }
        
        // Load from disk
        const content = await this.fileService.readFile(uri);
        const data = await this.serializer.dataToNotebook(content.value);
        
        return this.createModel(uri, 'jupyter-notebook', data);
    }
}
```

## Testing Requirements

### Unit Tests
**Location**: `/src/vs/workbench/contrib/positronNotebook/test/browser/model/positronNotebookModel.test.ts`

```typescript
suite('PositronNotebookModel - Core Operations', () => {
    let model: PositronNotebookModel;
    
    setup(() => {
        model = new PositronNotebookModel(
            URI.parse('file:///test.ipynb'),
            'jupyter-notebook'
        );
    });
    
    teardown(() => {
        model.dispose();
    });
    
    test('adds cells at correct positions', () => {
        const cell1 = model.addCell('code', 'print(1)');
        const cell2 = model.addCell('markdown', '# Header', 0);
        const cell3 = model.addCell('code', 'print(2)', 1);
        
        assert.strictEqual(model.cells[0].id, cell2.id);
        assert.strictEqual(model.cells[1].id, cell3.id);
        assert.strictEqual(model.cells[2].id, cell1.id);
    });
    
    test('removes cells correctly', () => {
        const cell1 = model.addCell('code', 'test1');
        const cell2 = model.addCell('code', 'test2');
        
        assert.strictEqual(model.removeCell(cell1.id), true);
        assert.strictEqual(model.cells.length, 1);
        assert.strictEqual(model.cells[0].id, cell2.id);
        
        assert.strictEqual(model.removeCell('invalid'), false);
    });
    
    test('moves cells correctly', () => {
        const cells = [
            model.addCell('code', 'A'),
            model.addCell('code', 'B'),
            model.addCell('code', 'C'),
            model.addCell('code', 'D')
        ];
        
        // Move B to end
        model.moveCell(cells[1].id, 3);
        assert.deepStrictEqual(
            model.cells.map(c => c.content),
            ['A', 'C', 'D', 'B']
        );
        
        // Move D to beginning
        model.moveCell(cells[3].id, 0);
        assert.deepStrictEqual(
            model.cells.map(c => c.content),
            ['D', 'A', 'C', 'B']
        );
    });
    
    test('tracks dirty state correctly', () => {
        assert.strictEqual(model.isDirty, false);
        
        const cell = model.addCell('code', 'test');
        assert.strictEqual(model.isDirty, true);
        
        model.setDirty(false);
        assert.strictEqual(model.isDirty, false);
        
        model.updateCellContent(cell.id, 'modified');
        assert.strictEqual(model.isDirty, true);
    });
    
    test('increments version on changes', () => {
        const initialVersion = model.versionId;
        
        model.addCell('code', 'test');
        assert.strictEqual(model.versionId, initialVersion + 1);
        
        model.updateMetadata({ custom: 'value' });
        assert.strictEqual(model.versionId, initialVersion + 2);
    });
    
    test('serializes and deserializes correctly', () => {
        // Add test data
        const cell1 = model.addCell('code', 'print("hello")');
        const cell2 = model.addCell('markdown', '# Title');
        model.updateMetadata({
            kernelspec: { name: 'python3', display_name: 'Python 3' }
        });
        
        // Serialize
        const data = model.serialize();
        
        // Create new model from serialized data
        const model2 = new PositronNotebookModel(
            URI.parse('file:///test2.ipynb'),
            'jupyter-notebook'
        );
        model2.deserialize(data);
        
        // Verify
        assert.strictEqual(model2.cells.length, 2);
        assert.strictEqual(model2.cells[0].content, 'print("hello")');
        assert.strictEqual(model2.cells[1].content, '# Title');
        assert.deepStrictEqual(model2.metadata.kernelspec, {
            name: 'python3',
            display_name: 'Python 3'
        });
    });
    
    test('handles concurrent operations safely', () => {
        const cells: PositronCell[] = [];
        
        // Add many cells rapidly
        for (let i = 0; i < 100; i++) {
            cells.push(model.addCell('code', `cell${i}`));
        }
        
        // Remove odd cells
        for (let i = 1; i < 100; i += 2) {
            model.removeCell(cells[i].id);
        }
        
        // Verify only even cells remain
        assert.strictEqual(model.cells.length, 50);
        for (let i = 0; i < model.cells.length; i++) {
            assert.strictEqual(model.cells[i].content, `cell${i * 2}`);
        }
    });
});

suite('PositronNotebookModel - Events', () => {
    test('fires correct events for operations', async () => {
        const model = new PositronNotebookModel(
            URI.parse('file:///test.ipynb'),
            'jupyter-notebook'
        );
        
        const events: NotebookContentChangeEvent[] = [];
        model.onDidChangeContent(e => events.push(e));
        
        // Add cell
        const cell = model.addCell('code', 'test');
        assert.strictEqual(events[0].type, 'cellAdded');
        assert.strictEqual(events[0].cellId, cell.id);
        
        // Update content
        model.updateCellContent(cell.id, 'modified');
        assert.strictEqual(events[1].type, 'contentChanged');
        
        // Move cell (with multiple cells)
        const cell2 = model.addCell('code', 'test2');
        model.moveCell(cell.id, 1);
        const moveEvent = events.find(e => e.type === 'cellMoved');
        assert.strictEqual(moveEvent?.cellId, cell.id);
        assert.strictEqual(moveEvent?.newIndex, 1);
        
        // Remove cell
        model.removeCell(cell.id);
        const removeEvent = events.find(e => e.type === 'cellRemoved');
        assert.strictEqual(removeEvent?.cellId, cell.id);
        
        model.dispose();
    });
});
```

### Performance Tests

```typescript
suite('PositronNotebookModel - Performance', () => {
    test('handles large notebooks efficiently', () => {
        const model = new PositronNotebookModel(
            URI.parse('file:///large.ipynb'),
            'jupyter-notebook'
        );
        
        const startTime = performance.now();
        
        // Add 1000 cells
        for (let i = 0; i < 1000; i++) {
            model.addCell('code', `print(${i})`);
        }
        
        const addTime = performance.now() - startTime;
        assert.ok(addTime < 100, `Adding 1000 cells took ${addTime}ms`);
        
        // Lookup performance (should be O(1))
        const lookupStart = performance.now();
        const middleCell = model.cells[500];
        const foundCell = model.getCellById(middleCell.id);
        const lookupTime = performance.now() - lookupStart;
        
        assert.ok(lookupTime < 1, `Cell lookup took ${lookupTime}ms`);
        assert.strictEqual(foundCell?.id, middleCell.id);
        
        // Serialization performance
        const serializeStart = performance.now();
        const data = model.serialize();
        const serializeTime = performance.now() - serializeStart;
        
        assert.ok(serializeTime < 50, `Serialization took ${serializeTime}ms`);
        assert.strictEqual(data.cells.length, 1000);
        
        model.dispose();
    });
});
```

## Validation Checklist

### Functional Requirements
- [ ] All cell operations work correctly (add, remove, move, update)
- [ ] Cell IDs are unique and stable
- [ ] Content changes are tracked
- [ ] Output updates work
- [ ] Metadata updates work
- [ ] Serialization round-trips correctly
- [ ] Dirty state tracking accurate
- [ ] Version ID increments properly

### Performance Requirements
- [ ] <100ms for 1000 cell operations
- [ ] O(1) cell lookups via Map
- [ ] <50ms serialization for large notebooks
- [ ] Memory efficient (no leaks)

### Code Quality
- [ ] Full TypeScript types
- [ ] >90% test coverage
- [ ] No linter warnings
- [ ] Proper error handling
- [ ] Memory cleanup on dispose

## Integration Points

### Files Modified
- Create all files in `/src/vs/workbench/contrib/positronNotebook/browser/model/`
- Register model factory in contribution point

### Dependencies Required
- VS Code base types (URI, Emitter, Event)
- Notebook types (NotebookData, ICellDto, IOutputDto)
- Service interfaces (IFileService, INotebookSerializer)

## Risk Mitigation

### Potential Issues
1. **Memory Management**: Cell listeners could leak
   - Solution: Proper disposal chain
2. **Event Storms**: Rapid updates overwhelming UI
   - Solution: Event debouncing in UI layer
3. **Large Outputs**: Memory exhaustion
   - Solution: Output size limits (Phase 2)

## Next Phase Dependencies
This phase provides:
- Complete model API for Phase 2 (Execution)
- Serialization for Phase 4 (File I/O)
- Event system for Phase 6 (UI Integration)
- Cell operations for Phase 5 (Undo/Redo)

## Success Metrics
- All tests passing
- Zero memory leaks
- Performance targets met
- Clean API surface
- Production-ready code