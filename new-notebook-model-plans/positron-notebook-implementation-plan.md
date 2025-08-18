# Implementation Plan: Independent Positron Notebook Model

> **Revision Note:** This plan has been updated based on technical review feedback. Major changes include:
> - Extended timeline from 12-16 weeks to 18-22 weeks
> - Corrected runtime API usage and maintained execution service integration
> - Added dedicated kernel lifecycle management phase
> - Expanded working copy adapter complexity acknowledgment
> - Enhanced undo/redo, output streaming, and execution queue details
> - Updated risk assessment based on identified complexities

## Executive Overview

Build a simplified, independent notebook model for Positron that eliminates VS Code's unnecessary complexity while maintaining all required functionality. This will reduce code complexity by ~70%, improve performance, and eliminate upstream merge conflicts.

**Timeline:** 18–22 weeks with 2–3 developers (revised based on technical review)
**Code Reduction:** From ~1400 lines to ~400-600 lines (accounting for adapter complexity)
**Key Benefit:** Simplified model with proper VS Code service integration

## Background & Motivation

### Why Build an Independent Model?

1. **UI and Model are in the same process** - No serialization boundary exists between them
2. **No extension compatibility needed** - Removes the primary complexity driver
3. **ICellEditOperation is unnecessary** - It solves problems Positron doesn't have
4. **Direct runtime integration** - Can use IRuntimeSessionService directly

### Expected Benefits

✅ **Simpler**: Intuitive API without operation indirection
✅ **Faster**: No operation processing overhead
✅ **Maintainable**: No upstream merge conflicts
✅ **Testable**: Simple code is easier to test
✅ **Appropriate**: Designed for Positron's actual needs

## Architecture Overview

### Current VS Code Architecture (Complex)
```
NotebookTextModel → ICellEditOperation → NotebookOperationManager → UndoRedoService
                 ↓
         INotebookExecutionService → INotebookKernelService → Runtime
```

### Proposed Positron Architecture (Simplified with Service Integration)
```
PositronNotebookModel → Direct Methods
         ↓                    ↓
    Working Copy         Execution Service Bridge
      Adapter           (INotebookExecutionService wrapper)
         ↓                    ↓
    IUndoRedoService   IRuntimeSessionService
```

## Implementation Phases

## Phase 0: Integration Spike (Weeks 0–2)

### Goals

- Validate UI adapter boundaries and event shapes
- Prove working copy/dirty/backup/hot-exit integration using existing Workbench services
- Attach to a runtime session minimally without replacing kernel UI

### Deliverables

- Minimal `IPositronNotebookModel` interface and `PositronCell` types with events for add/remove/move/update
- Adapter wiring in `PositronNotebookInstance` to render cells from the new model (no execution yet)
- Dirty tracking and save-as via existing notebook working copy path

### Exit criteria

- Cells render from the new model in the editor
- Dirty state flips correctly; autosave/backups and close prompts work as expected
- No regressions in editor open/close and working copy lifecycle

## Phase 1: Core Model Implementation (Weeks 2-4)

### 1.1 Create Base Model Structure

**Files to create:**
- `/src/vs/workbench/contrib/positronNotebook/browser/model/positronNotebookModel.ts`
- `/src/vs/workbench/contrib/positronNotebook/browser/model/positronCell.ts`
- `/src/vs/workbench/contrib/positronNotebook/browser/model/positronNotebookTypes.ts`

**Implementation details:**
- Move POC code from `positronNotebookModel.poc.ts` to proper module structure
- Implement IPositronNotebookModel interface with cells array and metadata
- Create PositronCell class with id, type, content, outputs
- Set up event emitters for change notifications

**Validation criteria:**
- Unit tests pass for basic operations (add/remove/move cells)
- Model can be instantiated and manipulated programmatically

### 1.2 Implement Cell Operations

**Core methods to implement:**
```typescript
addCell(type: 'code' | 'markdown', content: string, index?: number): PositronCell
removeCell(cellId: string): boolean
moveCell(cellId: string, newIndex: number): boolean
updateCellContent(cellId: string, content: string): boolean
clearCellOutputs(cellId: string): boolean
clearAllOutputs(): void
```

**Event system:**
- `onDidChangeContent` - Cell add/remove/move/content change
- `onDidChangeDirty` - Document dirty state
- `onDidChangeOutputs` - Cell output updates

## Phase 2: Execution Service Bridge (Weeks 5-7)

### 2.1 Execution Service Bridge Implementation

**Key changes:**
- Create bridge layer between PositronNotebookModel and existing execution services
- Maintain `INotebookExecutionService` and `INotebookExecutionStateService` for UI coordination
- Use `IRuntimeSessionService` for actual execution but preserve event flow
- Keep execution tracking, progress indicators, and cancellation working

**Code location:** Update `positronNotebookModel.ts`

```typescript
// Corrected implementation with proper API and execution tracking
async executeCell(cellId: string): Promise<void> {
  // Emit execution start event for UI coordination
  this._notebookExecutionService.notifyExecutionStart(this.uri, cellId);
  
  let session = this.runtimeService.getNotebookSessionForNotebookUri(this.uri);
  if (!session) {
    const runtimeId = this.getRuntimeIdForNotebook(); // derive from selected kernel via INotebookKernelService
    const sessionName = this.getSuggestedSessionName();
    const sessionId = await this.runtimeService.startNewRuntimeSession(
      runtimeId,
      sessionName,
      LanguageRuntimeSessionMode.Notebook,
      this.uri,
      'positron-notebook',
      RuntimeStartMode.Starting,
      true
    );
    session = this.runtimeService.getSession(sessionId);
  }

  const cell = this.cells.find(c => c.id === cellId);
  if (!cell) {
    throw new Error(`Cell not found: ${cellId}`);
  }

  // Generate unique execution ID for tracking
  const executionId = `cell-${cellId}-${Date.now()}`;
  
  // Execute using correct API signature
  session.execute(
    cell.content,
    executionId,
    RuntimeCodeExecutionMode.Interactive,
    RuntimeErrorBehavior.Continue
  );
  
  // Track execution state and handle outputs via event listeners
  // Emit execution end event when complete
}
```

**Bridging with kernel/execution services:**
- Map the selected kernel (via `INotebookKernelService`) to a runtime `runtimeId`
- Emit execution start/end events so `INotebookExecutionService` consumers (progress UI, cancellation) continue to work
- Preserve cancellation semantics by forwarding cancel requests to the session

### 2.2 Output Streaming & Memory Management

**Complexity acknowledged:**
- Incremental output updates during long-running cells
- Memory management for large outputs (GB-scale dataframes)
- Clear outputs during execution vs. after completion
- Output update coalescing for rapid streams

**Implementation strategy:**
```typescript
class OutputStreamManager {
  private outputBuffers = new Map<string, OutputBuffer>();
  private flushInterval = 100; // ms
  
  handleOutputStream(executionId: string, output: ILanguageRuntimeMessageStream): void {
    const buffer = this.getOrCreateBuffer(executionId);
    buffer.append(output);
    
    // Coalesce rapid updates
    if (!buffer.flushPending) {
      buffer.flushPending = true;
      setTimeout(() => this.flushBuffer(executionId), this.flushInterval);
    }
  }
  
  private flushBuffer(executionId: string): void {
    const buffer = this.outputBuffers.get(executionId);
    if (!buffer) return;
    
    // Update cell outputs with coalesced data
    const cell = this.getCellByExecutionId(executionId);
    cell.updateOutputs(buffer.getCoalescedOutputs());
    
    // Check memory usage and truncate if needed
    if (buffer.memoryUsage > MAX_OUTPUT_SIZE) {
      buffer.truncate();
      cell.showOutputTruncationWarning();
    }
    
    buffer.flushPending = false;
  }
}
```

**Memory management:**
- Implement output size limits with user-configurable thresholds
- Virtual scrolling for large text outputs
- Lazy loading for images and rich outputs
- Clear old outputs when memory pressure detected

### 2.3 Execution Queue Management

**Cell execution dependencies:**
- Track execution order and dependencies
- Handle queue management for sequential execution
- Support parallel execution where possible
- Manage long-running cell interruption

**Implementation approach:**
```typescript
class ExecutionQueueManager {
  private queue: ExecutionQueueItem[] = [];
  private executing = new Set<string>();
  private maxParallel = 1; // Configurable
  
  async queueExecution(cellId: string, priority: number = 0): Promise<void> {
    const item = { cellId, priority, promise: new Deferred() };
    this.queue.push(item);
    this.queue.sort((a, b) => b.priority - a.priority);
    
    await this.processQueue();
    return item.promise;
  }
  
  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.executing.size < this.maxParallel) {
      const item = this.queue.shift()!;
      this.executing.add(item.cellId);
      
      try {
        await this.executeCell(item.cellId);
        item.promise.resolve();
      } catch (error) {
        item.promise.reject(error);
      } finally {
        this.executing.delete(item.cellId);
        // Process next item
        this.processQueue();
      }
    }
  }
  
  cancelPending(): void {
    // Cancel all queued executions
    for (const item of this.queue) {
      item.promise.reject(new CancellationError());
    }
    this.queue = [];
  }
}
```

**Features:**
- Execute all cells above/below
- Smart dependency detection for re-execution
- Interrupt and resume capability
- Progress tracking for queue status

## Phase 3: Kernel Lifecycle Management (Weeks 8-9)

### 3.1 Kernel State Management

**Features to implement:**
- Handle kernel startup, shutdown, and restart operations
- Manage kernel switching (changing runtime/language)
- Track kernel state transitions (idle, busy, restarting)
- Implement reconnection logic for interrupted sessions

**Integration with INotebookKernelService:**
- Maintain kernel selection UI compatibility
- Map kernel changes to runtime session switches
- Preserve kernel preferences per notebook

### 3.2 Session Lifecycle

**Key operations:**
```typescript
async switchKernel(kernelId: string): Promise<void> {
  // Save current session state if needed
  const currentSession = this.getCurrentSession();
  if (currentSession) {
    await this.saveSessionState(currentSession);
    await currentSession.shutdown();
  }
  
  // Start new session with selected kernel
  const runtimeId = this.mapKernelToRuntime(kernelId);
  await this.startSession(runtimeId);
  
  // Restore or reinitialize notebook state
  await this.restoreNotebookContext();
}

async restartKernel(): Promise<void> {
  const session = this.getCurrentSession();
  if (!session) return;
  
  // Emit restart events for UI
  this._notebookExecutionService.notifyKernelRestart(this.uri);
  
  // Perform restart
  await session.restart();
  
  // Clear outputs if configured
  if (this.clearOutputsOnRestart) {
    this.clearAllOutputs();
  }
}
```

### 3.3 Error Recovery

**Handle common scenarios:**
- Kernel crash detection and auto-restart
- Network interruption recovery
- Resource exhaustion handling
- Graceful degradation when kernel unavailable

## Phase 4: File I/O & Persistence (Weeks 10-11)

### 4.1 Working Copy Adapter Implementation

**Critical complexity acknowledged:**
- `NotebookFileWorkingCopyModel` is tightly coupled to `NotebookTextModel`'s event system
- The ipynb serializer handles 500+ lines of edge cases (metadata preservation, output transformations, format variations)
- Creating adapters between `NotebookData` and new model is non-trivial

**Implementation approach:**
- Create `PositronNotebookWorkingCopyAdapter` to bridge event systems
- Map PositronNotebookModel events to expected NotebookTextModel-style events
- Implement proper dirty state tracking with event propagation
- Handle save/backup/hot-exit through adapter layer

**Serializer strategy:**
- Initially reuse existing ipynb serializer through careful data structure mapping
- Budget 2 full weeks for adapter implementation and testing
- Consider custom serializer only after adapter proves insufficient

### 4.2 Model Resolution

**Files to create:**
- `/src/vs/workbench/contrib/positronNotebook/browser/model/positronNotebookModelResolver.ts`

**Features:**
- Cache models by URI to avoid duplicates
- Handle model lifecycle (create/dispose)
- Integrate with workspace file system events

### 4.3 (Optional, future) Custom Serializer

If we decide to own serialization later:
- Create `positronNotebookSerializer.ts` and integrate via Workbench registration
- Achieve round-trip parity with existing serializer before switching the default

## Phase 5: Undo/Redo Implementation (Weeks 12-13)

### 5.1 Undo/Redo Complexity Analysis

**Critical challenges identified:**
- Cell selection restoration after undo/redo operations
- Operation grouping for multi-cell edits
- Coalescing rapid typing in cells
- Edit state management across multiple cells
- Coordination with editor-level undo/redo stacks

**Implementation approach:**
- Create `PositronNotebookUndoRedoElement` implementing `IUndoRedoElement`
- Track cell selections and viewport state with each operation
- Implement smart coalescing for content edits within time windows
- Maintain operation context for proper restoration

### 5.2 Detailed Implementation Strategy

**Operation tracking:**
```typescript
class PositronNotebookUndoRedoElement implements IUndoRedoElement {
  constructor(
    private readonly model: IPositronNotebookModel,
    private readonly operation: NotebookOperation,
    private readonly beforeState: NotebookState,
    private readonly afterState: NotebookState
  ) {}
  
  undo(): void {
    // Restore model to beforeState
    this.model.restoreState(this.beforeState);
    // Restore cell selections
    this.restoreSelections(this.beforeState.selections);
    // Restore viewport position
    this.restoreViewport(this.beforeState.viewport);
  }
  
  redo(): void {
    // Apply operation again
    this.model.applyOperation(this.operation);
    // Restore afterState selections and viewport
    this.restoreSelections(this.afterState.selections);
    this.restoreViewport(this.afterState.viewport);
  }
}
```

**Coalescing strategy:**
- Content edits: 500ms window for same cell
- Cell moves: Group if part of same drag operation
- Batch operations: Single undo/redo unit for multi-cell actions
- Metadata changes: Coalesce rapid property updates

## Phase 6: UI Integration (Weeks 14-16)

### 6.1 Update PositronNotebookInstance

**File to modify:**
- `/src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts`

**Changes at line 683:**
```typescript
// Before
this._textModel = model.notebook;

// After (with feature flag)
if (this.configService.getValue('positron.notebook.useIndependentModel')) {
    this._positronModel = await this.modelResolver.resolve(this.uri);
} else {
    this._textModel = model.notebook;
}
```

**Update cell sync logic (lines 686-700):**
- Conditionally use new model when feature flag enabled
- Maintain backward compatibility

### 6.2 Cell Wrapper Updates

**Files to modify:**
- `/src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookCells/createNotebookCell.ts`
- `/src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookCells/PositronNotebookCell.ts`

**Implementation:**
- Create adapter for new `PositronCell` type
- Map new cell interface to existing UI expectations:
  - IDs, kinds (`code`/`markdown`), source text, outputs, execution state, metadata
  - Selection/focus, collapse state, and change notifications
- Handle content changes through new model, preserving existing keyboard and selection behavior
- Note: line references are approximate and may shift as code evolves

## Phase 7: Testing & Validation (Weeks 17-19)

### 7.1 Unit Testing

**Test files to create:**
- `/src/vs/workbench/contrib/positronNotebook/test/browser/model/positronNotebookModel.test.ts`
- `/src/vs/workbench/contrib/positronNotebook/test/browser/model/positronNotebookUndoRedo.test.ts`
- `/src/vs/workbench/contrib/positronNotebook/test/browser/model/positronNotebookWorkingCopyAdapter.test.ts`
- `/src/vs/workbench/contrib/positronNotebook/test/browser/model/positronNotebookExecutionQueue.test.ts`
- `/src/vs/workbench/contrib/positronNotebook/test/browser/model/positronNotebookKernelLifecycle.test.ts`

**Test coverage targets:**
- Model operations: >90% coverage
- Serialization: Round-trip validation with sample notebooks
- Undo/redo: All operation types and edge cases
- Working copy integration: Dirty state, auto-save, hot-exit
- Large notebooks: Performance with 1000+ cells
- Output streaming: Memory limits and coalescing

### 7.2 Integration Testing

**E2E tests to add:**
- Create and execute notebook with new model
- Save and reload notebook with complex outputs
- Undo/redo operations with selection restoration
- Runtime service integration scenarios
- Kernel switching and restart operations
- Output rendering for various mime types
- Working copy backup and recovery
- Execution queue management
- Performance benchmarks with large outputs
- Kernel selection persistence and cancellation
- Concurrent cell execution handling
- Memory pressure scenarios

**Performance targets:**
- <100ms for common operations on 1000-cell notebooks
- <1s for loading large notebooks
- Memory usage comparable to or better than current implementation

## Phase 8: Migration & Rollout (Weeks 20-21)

### 7.1 Feature Flag Implementation

**Configuration to add:**
```json
{
  "positron.notebook.useIndependentModel": {
    "type": "boolean",
    "default": false,
    "description": "Use the new independent notebook model (experimental)"
  }
}
```

**Files to modify:**
- `/src/vs/workbench/contrib/positronNotebook/browser/positronNotebookExperimentalConfig.ts`
- `/src/vs/workbench/contrib/positronNotebook/browser/positronNotebook.contribution.ts`
  - Ensure alignment with `IPositronNotebookService.usingPositronNotebooks()` so there is a single source of truth for model selection

### 7.2 Gradual Rollout Plan

1. **Week 11:** Internal testing with team
2. **Week 12:** Beta release to selected users
3. **Monitor:** Telemetry and error reporting
4. **Iterate:** Fix issues discovered in beta
5. **GA Release:** After validation period

**Rollback strategy:**
- Feature flag allows instant rollback
- Keep VS Code model code for 2 release cycles
- Monitor telemetry for performance regressions

**Telemetry to add:**
- Execution success/failure counts and durations
- Output sizes and streaming rates
- Serialization/deserialization durations
- Autosave/backup frequency and durations
- Memory usage sampling during large output rendering

## Phase 9: Documentation & Cleanup (Week 22)

### 8.1 Documentation

**Documents to create:**
- `/src/vs/workbench/contrib/positronNotebook/browser/model/README.md` - Architecture overview
- `/docs/notebook-model-migration.md` - Migration guide
- API documentation in code comments

### 8.2 Code Cleanup

**When feature flag is enabled:**
- Remove NotebookTextModel imports
- Remove INotebookExecutionService usage
- Clean up adapter code
- Remove unused VS Code notebook infrastructure references

## Risk Analysis & Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Working copy adapter complexity | High | High | Budget 2 full weeks; create comprehensive adapter layer |
| Execution service bypass breaks UI | High | High | Keep thin wrapper around execution services |
| Runtime API misunderstanding | High | Medium | Validated correct API usage; added proper error handling |
| Serializer edge cases (500+ lines) | High | High | Reuse existing serializer; defer custom implementation |
| Undo/redo selection restoration | High | Medium | Track viewport and selection state with operations |
| Output streaming memory issues | High | Medium | Implement memory limits and truncation |
| Kernel lifecycle gaps | Medium | High | Dedicated phase for kernel management |
| Timeline underestimation | Medium | High | Extended to 18-22 weeks based on review |
| Integration test coverage gaps | Medium | Medium | Added comprehensive test scenarios |

## Testing Strategy

### Unit Tests
- Each model component tested in isolation
- Mock services for testing
- Edge case coverage

### Integration Tests
- Real notebook files from various sources
- Runtime integration with actual kernels
- File I/O with real file system

### Performance Tests
- Benchmark suite with notebooks of various sizes
- Memory profiling
- Operation timing

### User Acceptance Testing
- Data science team validation
- Common workflow testing
- Feature parity verification

## Success Criteria

1. ✅ **Functionality:** All existing notebook features work
2. ✅ **Performance:** <100ms for operations on 1000-cell notebooks
3. ✅ **Code Quality:** 70% reduction in model complexity
4. ✅ **Maintainability:** Zero upstream merge conflicts
5. ✅ **Reliability:** No increase in error rates (telemetry)
6. ✅ **Migration:** Smooth transition with feature flag
7. ✅ **Workbench Integration:** Undo/redo and working copy behavior match existing expectations

## Open Questions

### Requirements Clarification
1. Should we support notebook format versions other than nbformat 4.x?
2. What's the expected behavior for conflicting runtime sessions?
3. Should undo/redo be global or per-notebook?
4. Do we need to support collaborative editing in the future?
5. Do we retain the current kernel selection UX (`INotebookKernelService`) and map to runtime sessions, or replace it?
6. What level of attachments and ipywidget state persistence is required for v1?

### Technical Decisions
1. Exact format of runtime output events (verify with runtime team)
2. How to handle notebook-level metadata that VS Code extensions might expect
3. Whether we need to support custom renderers for outputs
4. Memory management strategy for large notebooks
5. Persistence path decision: continue reusing existing ipynb serializer or plan a later switch to a custom serializer?
6. Undo/redo semantics: confirm we integrate with Workbench `IUndoRedoService` for global stack consistency

## Timeline Summary

| Phase | Duration | Description |
|-------|----------|-------------|
| Phase 0 | Weeks 0–2 | Integration spike (adapter + working copy validation) |
| Phase 1 | Weeks 2-4 | Core model implementation |
| Phase 2 | Weeks 5-7 | Execution service bridge (with output streaming) |
| Phase 3 | Weeks 8-9 | Kernel lifecycle management |
| Phase 4 | Weeks 10-11 | File I/O & persistence (working copy adapter) |
| Phase 5 | Weeks 12-13 | Undo/redo (complex Workbench integration) |
| Phase 6 | Weeks 14-16 | UI integration |
| Phase 7 | Weeks 17-19 | Testing & validation |
| Phase 8 | Weeks 20-21 | Migration & rollout |
| Phase 9 | Week 22 | Documentation & cleanup |

**Total Duration:** 18–22 weeks with 2–3 developers (revised based on technical review)

## Appendix A: Code Samples

### Simple Direct API Example
```typescript
// Current VS Code approach (complex)
const edits = [
  { editType: CellEditType.Replace, index: 0, count: 1, cells: [...] }
];
textModel.applyEdits(edits, true, selectionState, () => newSelection);

// New Positron approach (simple)
const cell = model.addCell('code', 'print("Hello")', 0);
await model.executeCell(cell.id);
```

### Undo/Redo Simplification
```typescript
// Use the Workbench IUndoRedoService for global consistency
undoRedoService.pushElement({
  type: 0, // Resource-based element (illustrative)
  label: 'Add Cell',
  resource: model.uri,
  undo: () => model.removeCell(addedCellId),
  redo: () => { addedCellId = model.addCell('code', content, index).id; }
}, { groupId: 0 });
```

## Appendix B: Migration Checklist

- [ ] Feature flag configuration added
- [ ] Core model implementation complete
- [ ] Runtime integration working
- [ ] File I/O functional
- [ ] Undo/redo implemented
- [ ] UI integration with adapter pattern
- [ ] Unit tests passing (>80% coverage)
- [ ] Integration tests passing
- [ ] Performance benchmarks met
- [ ] Documentation complete
- [ ] Beta testing successful
- [ ] Telemetry shows no regressions
- [ ] Team sign-off received
- [ ] GA release approved

## Next Steps

1. **Completed:** Technical review and plan revision based on feedback
2. **Next:** Stakeholder review and approval of revised timeline
3. **Phase 0 Start:** Conduct 2-week integration spike to validate approach
4. **Weekly:** Progress reviews with stakeholders
5. **Ongoing:** Update this document as implementation progresses and discoveries are made

---

*This revised plan provides a realistic, systematic approach to replacing VS Code's complex notebook model with a simpler solution designed specifically for Positron's needs, while properly maintaining integration with essential VS Code services.*
