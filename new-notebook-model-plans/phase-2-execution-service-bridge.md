# Phase 2: Execution Service Bridge - Positron Notebook Model
## Timeline: Weeks 5-7

## Executive Summary
Implement the critical bridge between the Positron notebook model and runtime execution services. This phase handles cell execution, output streaming, memory management, and execution queue management while maintaining compatibility with existing UI components through event coordination.

## Prerequisites
- Phase 1 (Core Model) completed
- IRuntimeSessionService understanding
- INotebookExecutionService interface knowledge
- Output streaming patterns familiarity

## Background Context

### Execution Architecture Challenge
VS Code's execution model is tightly coupled to its kernel service. We need to bridge between:
- **Existing UI expectations**: Progress indicators, cancellation, execution state
- **Runtime service reality**: Direct session management, different event patterns
- **Performance requirements**: Stream processing, memory limits, queue management

### Key Complexity Areas
1. **Output Streaming**: Handle GB-scale outputs without blocking
2. **Memory Management**: Prevent exhaustion with large dataframes
3. **Queue Management**: Sequential and parallel execution coordination
4. **Event Bridging**: Map runtime events to UI expectations

## Implementation Tasks

### Task 1: Execution Service Bridge Core
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/execution/positronNotebookExecutionBridge.ts`

```typescript
export interface IPositronNotebookExecutionBridge {
    executeCell(model: IPositronNotebookModel, cellId: string): Promise<void>;
    executeCells(model: IPositronNotebookModel, cellIds: string[]): Promise<void>;
    cancelExecution(cellId: string): Promise<void>;
    cancelAllExecutions(): Promise<void>;
    
    readonly onDidStartExecution: Event<{ cellId: string; executionId: string }>;
    readonly onDidEndExecution: Event<{ cellId: string; success: boolean }>;
}

@registerSingleton(IPositronNotebookExecutionBridge, PositronNotebookExecutionBridge)
export class PositronNotebookExecutionBridge extends Disposable implements IPositronNotebookExecutionBridge {
    private readonly _executions = new Map<string, ExecutionContext>();
    private readonly _queueManager: ExecutionQueueManager;
    private readonly _outputManager: OutputStreamManager;
    
    private readonly _onDidStartExecution = this._register(new Emitter<{ cellId: string; executionId: string }>());
    readonly onDidStartExecution = this._onDidStartExecution.event;
    
    private readonly _onDidEndExecution = this._register(new Emitter<{ cellId: string; success: boolean }>());
    readonly onDidEndExecution = this._onDidEndExecution.event;
    
    constructor(
        @IRuntimeSessionService private readonly runtimeService: IRuntimeSessionService,
        @INotebookExecutionService private readonly notebookExecutionService: INotebookExecutionService,
        @INotebookExecutionStateService private readonly executionStateService: INotebookExecutionStateService,
        @INotebookKernelService private readonly kernelService: INotebookKernelService,
        @ILogService private readonly logService: ILogService
    ) {
        super();
        
        this._queueManager = this._register(new ExecutionQueueManager());
        this._outputManager = this._register(new OutputStreamManager());
        
        this._registerRuntimeListeners();
    }
    
    async executeCell(model: IPositronNotebookModel, cellId: string): Promise<void> {
        const cell = model.getCellById(cellId);
        if (!cell) {
            throw new Error(`Cell not found: ${cellId}`);
        }
        
        // Check for existing execution
        if (this._executions.has(cellId)) {
            this.logService.warn(`Cell ${cellId} is already executing`);
            return;
        }
        
        // Get or create runtime session
        const session = await this._ensureRuntimeSession(model);
        if (!session) {
            throw new Error('Failed to create runtime session');
        }
        
        // Create execution context
        const executionId = `exec-${cellId}-${Date.now()}`;
        const context: ExecutionContext = {
            cellId,
            executionId,
            session,
            startTime: Date.now(),
            state: 'pending'
        };
        
        this._executions.set(cellId, context);
        
        try {
            // Notify UI services for progress tracking
            this._notifyExecutionStart(model, cellId, executionId);
            
            // Queue execution
            await this._queueManager.queueExecution(async () => {
                context.state = 'executing';
                
                // Clear outputs if configured
                if (this._shouldClearOutputs()) {
                    model.clearCellOutputs(cellId);
                }
                
                // Execute through runtime session
                await this._executeWithSession(session, cell, executionId);
                
                context.state = 'completed';
            }, { cellId, priority: 0 });
            
            // Success
            this._notifyExecutionEnd(model, cellId, true);
            
        } catch (error) {
            // Handle execution error
            this.logService.error(`Execution failed for cell ${cellId}:`, error);
            
            context.state = 'failed';
            this._handleExecutionError(model, cellId, error);
            this._notifyExecutionEnd(model, cellId, false);
            
            throw error;
        } finally {
            this._executions.delete(cellId);
        }
    }
    
    async executeCells(model: IPositronNotebookModel, cellIds: string[]): Promise<void> {
        // Execute cells sequentially by default
        for (const cellId of cellIds) {
            try {
                await this.executeCell(model, cellId);
            } catch (error) {
                // Option: Continue or stop on error
                if (this._stopOnError()) {
                    throw error;
                }
                this.logService.warn(`Continuing after error in cell ${cellId}`);
            }
        }
    }
    
    private async _ensureRuntimeSession(model: IPositronNotebookModel): Promise<ILanguageRuntimeSession | undefined> {
        // Check for existing session
        let session = this.runtimeService.getNotebookSessionForNotebookUri(model.uri);
        
        if (!session) {
            // Get selected kernel to determine runtime
            const kernel = this.kernelService.getSelectedOrSuggestedKernel(model.uri);
            if (!kernel) {
                throw new Error('No kernel selected');
            }
            
            // Map kernel to runtime ID
            const runtimeId = this._mapKernelToRuntimeId(kernel);
            const sessionName = this._generateSessionName(model);
            
            // Start new session
            const sessionId = await this.runtimeService.startNewRuntimeSession(
                runtimeId,
                sessionName,
                LanguageRuntimeSessionMode.Notebook,
                model.uri,
                'positron-notebook',
                RuntimeStartMode.Starting,
                true // hidden
            );
            
            session = this.runtimeService.getSession(sessionId);
            
            // Wait for session to be ready
            await this._waitForSessionReady(session);
        }
        
        return session;
    }
    
    private async _executeWithSession(
        session: ILanguageRuntimeSession,
        cell: IPositronCell,
        executionId: string
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const disposables = new DisposableStore();
            
            // Set up output handling
            const outputHandler = this._outputManager.createHandler(cell.id, (outputs) => {
                // Update cell outputs through model
                const model = this._getModelForCell(cell.id);
                if (model) {
                    model.updateCellOutputs(cell.id, outputs);
                }
            });
            
            // Listen for execution results
            disposables.add(session.onDidReceiveRuntimeMessageResult((message) => {
                if (message.parent_id !== executionId) {
                    return;
                }
                
                // Handle result output
                outputHandler.handleResult(message);
            }));
            
            // Listen for stream outputs
            disposables.add(session.onDidReceiveRuntimeMessageStream((message) => {
                if (message.parent_id !== executionId) {
                    return;
                }
                
                // Handle stream output with coalescing
                outputHandler.handleStream(message);
            }));
            
            // Listen for errors
            disposables.add(session.onDidReceiveRuntimeMessageError((message) => {
                if (message.parent_id !== executionId) {
                    return;
                }
                
                outputHandler.handleError(message);
            }));
            
            // Listen for completion
            disposables.add(session.onDidReceiveRuntimeMessageStatus((message) => {
                if (message.parent_id !== executionId) {
                    return;
                }
                
                if (message.status === 'idle') {
                    // Execution complete
                    outputHandler.flush();
                    disposables.dispose();
                    resolve();
                }
            }));
            
            // Execute the code
            session.execute(
                cell.content,
                executionId,
                RuntimeCodeExecutionMode.Interactive,
                RuntimeErrorBehavior.Continue
            );
            
            // Set up timeout
            const timeout = setTimeout(() => {
                disposables.dispose();
                reject(new Error('Execution timeout'));
            }, this._getExecutionTimeout());
            
            disposables.add(toDisposable(() => clearTimeout(timeout)));
        });
    }
    
    private _notifyExecutionStart(model: IPositronNotebookModel, cellId: string, executionId: string): void {
        // Emit for UI coordination
        this._onDidStartExecution.fire({ cellId, executionId });
        
        // Notify execution service for progress UI
        this.notebookExecutionService['_notifyExecutionStart']?.(model.uri, cellId);
        
        // Update execution state service
        this.executionStateService['_setCellExecution'](model.uri, cellId, {
            executionOrder: this._getNextExecutionOrder(),
            isPaused: false
        });
    }
    
    private _notifyExecutionEnd(model: IPositronNotebookModel, cellId: string, success: boolean): void {
        // Emit for UI coordination  
        this._onDidEndExecution.fire({ cellId, success });
        
        // Notify execution service
        this.notebookExecutionService['_notifyExecutionEnd']?.(model.uri, cellId);
        
        // Clear execution state
        this.executionStateService['_clearCellExecution'](model.uri, cellId);
    }
}
```

### Task 2: Output Stream Manager
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/execution/outputStreamManager.ts`

```typescript
interface OutputBuffer {
    cellId: string;
    outputs: IPositronCellOutput[];
    streamBuffers: Map<string, string[]>;
    flushPending: boolean;
    memoryUsage: number;
    lastFlush: number;
}

export class OutputStreamManager extends Disposable {
    private static readonly FLUSH_INTERVAL = 100; // ms
    private static readonly MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB
    private static readonly TRUNCATE_SIZE = 1 * 1024 * 1024; // Keep 1MB when truncating
    
    private readonly _buffers = new Map<string, OutputBuffer>();
    
    createHandler(cellId: string, onUpdate: (outputs: IPositronCellOutput[]) => void): IOutputHandler {
        const buffer = this._getOrCreateBuffer(cellId);
        
        return {
            handleStream: (message: ILanguageRuntimeMessageStream) => {
                this._handleStream(buffer, message);
                this._scheduleFlush(buffer, onUpdate);
            },
            
            handleResult: (message: ILanguageRuntimeMessageOutput) => {
                this._handleResult(buffer, message);
                this._scheduleFlush(buffer, onUpdate);
            },
            
            handleError: (message: ILanguageRuntimeMessageError) => {
                this._handleError(buffer, message);
                this._scheduleFlush(buffer, onUpdate);
            },
            
            flush: () => {
                this._flushBuffer(buffer, onUpdate);
            },
            
            clear: () => {
                buffer.outputs = [];
                buffer.streamBuffers.clear();
                buffer.memoryUsage = 0;
                onUpdate([]);
            }
        };
    }
    
    private _getOrCreateBuffer(cellId: string): OutputBuffer {
        let buffer = this._buffers.get(cellId);
        if (!buffer) {
            buffer = {
                cellId,
                outputs: [],
                streamBuffers: new Map(),
                flushPending: false,
                memoryUsage: 0,
                lastFlush: Date.now()
            };
            this._buffers.set(cellId, buffer);
        }
        return buffer;
    }
    
    private _handleStream(buffer: OutputBuffer, message: ILanguageRuntimeMessageStream): void {
        const streamName = message.name; // 'stdout' or 'stderr'
        
        // Get or create stream buffer
        let streamBuffer = buffer.streamBuffers.get(streamName);
        if (!streamBuffer) {
            streamBuffer = [];
            buffer.streamBuffers.set(streamName, streamBuffer);
        }
        
        // Append to buffer
        streamBuffer.push(message.text);
        
        // Update memory estimate
        buffer.memoryUsage += message.text.length * 2; // Rough estimate (UTF-16)
        
        // Check memory limit
        if (buffer.memoryUsage > OutputStreamManager.MAX_OUTPUT_SIZE) {
            this._truncateOutputs(buffer);
        }
    }
    
    private _handleResult(buffer: OutputBuffer, message: ILanguageRuntimeMessageOutput): void {
        // Convert runtime output to notebook output format
        const output: IPositronCellOutput = {
            outputId: generateUuid(),
            outputs: [{
                mime: message.mime_type || 'text/plain',
                data: message.data
            }],
            metadata: message.metadata
        };
        
        buffer.outputs.push(output);
        
        // Update memory usage
        const dataSize = JSON.stringify(message.data).length * 2;
        buffer.memoryUsage += dataSize;
        
        if (buffer.memoryUsage > OutputStreamManager.MAX_OUTPUT_SIZE) {
            this._truncateOutputs(buffer);
        }
    }
    
    private _handleError(buffer: OutputBuffer, message: ILanguageRuntimeMessageError): void {
        // Create error output
        const errorOutput: IPositronCellOutput = {
            outputId: generateUuid(),
            outputs: [{
                mime: 'application/vnd.code.notebook.error',
                data: {
                    name: message.name,
                    message: message.message,
                    stack: message.traceback?.join('\n')
                }
            }]
        };
        
        buffer.outputs.push(errorOutput);
    }
    
    private _scheduleFlush(buffer: OutputBuffer, onUpdate: (outputs: IPositronCellOutput[]) => void): void {
        if (buffer.flushPending) {
            return;
        }
        
        buffer.flushPending = true;
        
        // Calculate delay based on time since last flush
        const timeSinceFlush = Date.now() - buffer.lastFlush;
        const delay = Math.max(0, OutputStreamManager.FLUSH_INTERVAL - timeSinceFlush);
        
        setTimeout(() => {
            this._flushBuffer(buffer, onUpdate);
        }, delay);
    }
    
    private _flushBuffer(buffer: OutputBuffer, onUpdate: (outputs: IPositronCellOutput[]) => void): void {
        // Coalesce stream outputs
        for (const [streamName, lines] of buffer.streamBuffers) {
            if (lines.length === 0) continue;
            
            const text = lines.join('');
            const streamOutput: IPositronCellOutput = {
                outputId: generateUuid(),
                outputs: [{
                    mime: 'application/vnd.code.notebook.stdout',
                    data: { text, name: streamName }
                }]
            };
            
            // Find existing stream output to append to
            const existingIndex = buffer.outputs.findIndex(o => 
                o.outputs[0]?.mime === 'application/vnd.code.notebook.stdout' &&
                o.outputs[0]?.data?.name === streamName
            );
            
            if (existingIndex >= 0) {
                // Append to existing
                buffer.outputs[existingIndex].outputs[0].data.text += text;
            } else {
                // Add new stream output
                buffer.outputs.push(streamOutput);
            }
            
            // Clear buffer
            lines.length = 0;
        }
        
        // Send update
        onUpdate([...buffer.outputs]);
        
        buffer.flushPending = false;
        buffer.lastFlush = Date.now();
    }
    
    private _truncateOutputs(buffer: OutputBuffer): void {
        // Keep only the most recent outputs
        const bytesToKeep = OutputStreamManager.TRUNCATE_SIZE;
        let currentSize = 0;
        let keepFrom = buffer.outputs.length;
        
        // Walk backwards to find cutoff point
        for (let i = buffer.outputs.length - 1; i >= 0; i--) {
            const outputSize = JSON.stringify(buffer.outputs[i]).length * 2;
            if (currentSize + outputSize > bytesToKeep) {
                keepFrom = i + 1;
                break;
            }
            currentSize += outputSize;
        }
        
        // Truncate
        if (keepFrom > 0) {
            // Add truncation notice
            const truncationNotice: IPositronCellOutput = {
                outputId: generateUuid(),
                outputs: [{
                    mime: 'text/plain',
                    data: `[Output truncated - showing last ${buffer.outputs.length - keepFrom} items]`
                }]
            };
            
            buffer.outputs = [truncationNotice, ...buffer.outputs.slice(keepFrom)];
            buffer.memoryUsage = currentSize;
        }
    }
    
    override dispose(): void {
        // Flush all pending buffers
        for (const buffer of this._buffers.values()) {
            if (buffer.flushPending) {
                // Force flush without callback
                buffer.streamBuffers.clear();
                buffer.flushPending = false;
            }
        }
        
        this._buffers.clear();
        super.dispose();
    }
}
```

### Task 3: Execution Queue Manager
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/execution/executionQueueManager.ts`

```typescript
interface QueueItem {
    id: string;
    execute: () => Promise<void>;
    priority: number;
    deferred: DeferredPromise<void>;
    options?: {
        cellId?: string;
        dependencies?: string[];
        canRunInParallel?: boolean;
    };
}

export class ExecutionQueueManager extends Disposable {
    private readonly _queue: QueueItem[] = [];
    private readonly _executing = new Set<string>();
    private _maxParallel = 1; // Default to sequential
    private _isPaused = false;
    
    private readonly _onDidChangeQueue = this._register(new Emitter<void>());
    readonly onDidChangeQueue = this._onDidChangeQueue.event;
    
    async queueExecution(
        execute: () => Promise<void>,
        options?: QueueItem['options'] & { priority?: number }
    ): Promise<void> {
        const id = generateUuid();
        const deferred = new DeferredPromise<void>();
        
        const item: QueueItem = {
            id,
            execute,
            priority: options?.priority ?? 0,
            deferred,
            options
        };
        
        // Insert based on priority
        const insertIndex = this._findInsertIndex(item.priority);
        this._queue.splice(insertIndex, 0, item);
        
        this._onDidChangeQueue.fire();
        
        // Process queue
        this._processQueue();
        
        return deferred.p;
    }
    
    async executeAll(cellIds: string[], model: IPositronNotebookModel): Promise<void> {
        // Queue all cells with dependencies
        const promises: Promise<void>[] = [];
        
        for (let i = 0; i < cellIds.length; i++) {
            const cellId = cellIds[i];
            const dependencies = i > 0 ? [cellIds[i - 1]] : [];
            
            const promise = this.queueExecution(
                async () => {
                    // Execute through bridge
                    await this._executionBridge.executeCell(model, cellId);
                },
                {
                    cellId,
                    dependencies,
                    priority: cellIds.length - i // Higher priority for earlier cells
                }
            );
            
            promises.push(promise);
        }
        
        // Wait for all to complete
        await Promise.all(promises);
    }
    
    cancelPending(): void {
        // Cancel all queued items
        for (const item of this._queue) {
            item.deferred.error(new CancellationError());
        }
        
        this._queue.length = 0;
        this._onDidChangeQueue.fire();
    }
    
    cancelExecution(cellId: string): boolean {
        // Find and remove from queue
        const index = this._queue.findIndex(item => item.options?.cellId === cellId);
        if (index >= 0) {
            const [item] = this._queue.splice(index, 1);
            item.deferred.error(new CancellationError());
            this._onDidChangeQueue.fire();
            return true;
        }
        
        // Check if currently executing
        if (this._executing.has(cellId)) {
            // Request cancellation through runtime
            this._requestRuntimeCancellation(cellId);
            return true;
        }
        
        return false;
    }
    
    pause(): void {
        this._isPaused = true;
    }
    
    resume(): void {
        this._isPaused = false;
        this._processQueue();
    }
    
    setMaxParallel(max: number): void {
        this._maxParallel = Math.max(1, max);
        this._processQueue();
    }
    
    private async _processQueue(): Promise<void> {
        if (this._isPaused) {
            return;
        }
        
        while (this._queue.length > 0 && this._executing.size < this._maxParallel) {
            const item = this._getNextExecutable();
            if (!item) {
                break; // No executable items (dependencies not met)
            }
            
            this._executing.add(item.id);
            if (item.options?.cellId) {
                this._executing.add(item.options.cellId);
            }
            
            // Execute asynchronously
            this._executeItem(item).finally(() => {
                this._executing.delete(item.id);
                if (item.options?.cellId) {
                    this._executing.delete(item.options.cellId);
                }
                
                this._onDidChangeQueue.fire();
                
                // Process next item
                this._processQueue();
            });
        }
    }
    
    private _getNextExecutable(): QueueItem | undefined {
        for (let i = 0; i < this._queue.length; i++) {
            const item = this._queue[i];
            
            // Check dependencies
            if (item.options?.dependencies) {
                const allDependenciesMet = item.options.dependencies.every(dep => 
                    !this._executing.has(dep) && 
                    !this._queue.some(q => q.options?.cellId === dep)
                );
                
                if (!allDependenciesMet) {
                    continue;
                }
            }
            
            // Check if can run in parallel
            if (!item.options?.canRunInParallel && this._executing.size > 0) {
                continue;
            }
            
            // Remove from queue and return
            this._queue.splice(i, 1);
            return item;
        }
        
        return undefined;
    }
    
    private async _executeItem(item: QueueItem): Promise<void> {
        try {
            await item.execute();
            item.deferred.complete();
        } catch (error) {
            item.deferred.error(error);
        }
    }
    
    private _findInsertIndex(priority: number): number {
        for (let i = 0; i < this._queue.length; i++) {
            if (this._queue[i].priority < priority) {
                return i;
            }
        }
        return this._queue.length;
    }
    
    getQueueStatus(): { queued: number; executing: number; cellIds: string[] } {
        return {
            queued: this._queue.length,
            executing: this._executing.size,
            cellIds: this._queue
                .map(item => item.options?.cellId)
                .filter(Boolean) as string[]
        };
    }
}
```

## Testing Requirements

### Integration Tests
```typescript
suite('PositronNotebookExecutionBridge - Integration', () => {
    let bridge: PositronNotebookExecutionBridge;
    let model: IPositronNotebookModel;
    let runtimeService: MockRuntimeService;
    
    setup(() => {
        runtimeService = new MockRuntimeService();
        bridge = new PositronNotebookExecutionBridge(
            runtimeService,
            // ... other services
        );
        
        model = createTestModel();
    });
    
    test('executes cell with runtime session', async () => {
        const cell = model.addCell('code', 'print("hello")');
        
        await bridge.executeCell(model, cell.id);
        
        assert.strictEqual(runtimeService.executeCalls.length, 1);
        assert.strictEqual(runtimeService.executeCalls[0].code, 'print("hello")');
    });
    
    test('handles streaming output correctly', async () => {
        const cell = model.addCell('code', 'for i in range(100): print(i)');
        
        // Set up mock to stream outputs
        runtimeService.mockStreamOutputs(100);
        
        await bridge.executeCell(model, cell.id);
        
        // Check outputs were coalesced
        assert.ok(cell.outputs.length < 100, 'Outputs should be coalesced');
        assert.ok(cell.outputs[0].data.text.includes('99'), 'Should contain all output');
    });
    
    test('respects memory limits', async () => {
        const cell = model.addCell('code', 'print("x" * 100000000)'); // 100MB
        
        await bridge.executeCell(model, cell.id);
        
        // Check truncation occurred
        const output = cell.outputs[0];
        assert.ok(output.data.text.includes('[Output truncated'));
    });
    
    test('queues multiple executions', async () => {
        const cells = [
            model.addCell('code', 'import time; time.sleep(0.1)'),
            model.addCell('code', 'print(1)'),
            model.addCell('code', 'print(2)')
        ];
        
        const promises = cells.map(c => bridge.executeCell(model, c.id));
        
        // Check queue status
        const status = bridge.getQueueStatus();
        assert.ok(status.queued > 0);
        
        await Promise.all(promises);
        
        // Verify execution order
        assert.deepStrictEqual(
            runtimeService.executeCalls.map(c => c.code),
            cells.map(c => c.content)
        );
    });
});
```

## Configuration Options

```typescript
interface ExecutionConfiguration {
    'positron.notebook.execution.clearOutputsBeforeRun': boolean;
    'positron.notebook.execution.stopOnError': boolean;
    'positron.notebook.execution.maxParallelExecutions': number;
    'positron.notebook.execution.timeoutMs': number;
    'positron.notebook.execution.outputFlushIntervalMs': number;
    'positron.notebook.execution.maxOutputSizeMB': number;
}
```

## Success Criteria
- ✅ Cells execute through runtime service
- ✅ Outputs stream and coalesce properly
- ✅ Memory limits enforced
- ✅ Execution queue works sequentially and in parallel
- ✅ Cancellation works correctly
- ✅ UI progress indicators continue working
- ✅ No performance regression for large outputs

## Risk Mitigation

### High Risk Areas
1. **Memory Exhaustion**: Large dataframe outputs
   - Solution: Truncation and virtual scrolling
2. **Event Mapping**: Runtime events don't match UI expectations
   - Solution: Comprehensive event bridge
3. **Queue Deadlocks**: Dependencies create circular wait
   - Solution: Dependency cycle detection

## Next Phase Dependencies
This phase enables:
- Phase 3: Kernel lifecycle (session management foundation)
- Phase 6: UI integration (execution state display)
- Phase 7: Testing (execution scenarios)