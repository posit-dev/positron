# Positron Notebooks Debugging Guide

Detailed debugging strategies and common issues for Positron Notebooks development.

## Debugging Setup

### Using VS Code Debug Tasks

**Primary debugging method**: Use VS Code's built-in launch configurations.

1. Open Run and Debug panel (Cmd+Shift+D)
2. Select "Launch Positron" or relevant debug configuration
3. Set breakpoints in TypeScript source
4. Start debugging (F5)

**Benefits:**
- Full TypeScript debugging with source maps
- Set breakpoints in any file
- Inspect variables and call stacks
- Hot reload with watch daemons

### Log Service

Add logging throughout notebook code:

```typescript
this._logService.info('[Positron Notebook] Message', data);
this._logService.warn('[Positron Notebook] Warning', data);
this._logService.error('[Positron Notebook] Error', error);
```

View logs:
- Output panel → "Log (Window)" or "Log (Extension Host)"
- Filter for "[Positron Notebook]"

### Context Keys Inspection

Check current context keys:
1. Command Palette → "Developer: Inspect Context Keys"
2. Look for notebook-specific keys:
   - `positronNotebookEditorFocused`
   - `positronNotebookCellType`
   - `positronNotebookCellExecuting`
   - etc.

## Common Issues and Solutions

### Selection/Focus Issues

**Symptom**: Cells not responding to keyboard commands, wrong cell selected

**Debug steps:**
1. Check selection machine state:
```typescript
// In selectionMachine.ts, add logging
console.log('[SelectionMachine]', event, this.state.value);
```

2. Verify cell focus:
```typescript
// In PositronNotebookInstance.ts
this._logService.info('[Positron Notebook] Focused cell', this._focusedCell.get());
```

3. Check DOM focus:
- Use browser DevTools
- Inspect `document.activeElement`
- Verify cell container has focus attribute

4. Verify context keys:
- Use "Inspect Context Keys" command
- Check cell-level scoping

**Common causes:**
- Context keys not updating after state change
- Focus not propagating to Monaco editor
- Selection machine in wrong state
- Event not triggering state transition

### Execution Issues

**Symptom**: Cell not executing, stuck in executing state, outputs not appearing

**Debug steps:**
1. Check kernel selection:
```typescript
// In PositronNotebookInstance.ts
const kernel = this._notebookKernelService.getSelectedOrSuggestedKernel(this._notebookModel);
this._logService.info('[Positron Notebook] Selected kernel', kernel);
```

2. Verify execution service:
```typescript
// In executeCell()
this._logService.info('[Positron Notebook] Starting execution', cellUri);
```

3. Check runtime session state:
```typescript
this._logService.info('[Positron Notebook] Runtime session', this._runtimeSession.value?.metadata);
```

4. Monitor execution events:
```typescript
// Subscribe to execution state changes
this._register(this._notebookExecutionStateService.onDidChangeExecution(e => {
	this._logService.info('[Positron Notebook] Execution changed', e);
}));
```

**Common causes:**
- No kernel selected
- Kernel not started
- Previous execution not cancelled
- Runtime session disconnected
- Execution service not firing events

### Output Rendering Issues

**Symptom**: Outputs not rendering, webviews not mounting, blank output areas

**Debug steps:**
1. Check output parsing:
```typescript
// In PositronNotebookCodeCell.ts
this._logService.info('[Positron Notebook] Parsed outputs', this._outputs.get());
```

2. Verify webview preloads:
```typescript
// Check registered preloads
const preloads = this._positronWebviewPreloadService.getPreloads();
this._logService.info('[Positron Notebook] Preloads', preloads);
```

3. Inspect webview lifecycle:
```typescript
// In useWebviewMount.ts
console.log('[Webview Mount] Mounting webview', output.id);
```

4. Check webview developer tools:
- Right-click output area
- "Inspect Element" to open webview DevTools
- Check console for errors

**Common causes:**
- Output MIME type not supported
- Webview preload not registered
- Mounting lifecycle issue
- Security policy blocking content

### Context Key Issues

**Symptom**: Commands not available in menus, keyboard shortcuts not working

**Debug steps:**
1. Verify context key values:
```typescript
// In ContextKeysManager.ts
this._logService.info('[Context Keys] Setting key', key, value);
```

2. Check when-clause evaluation:
- Look at command registration in `positronNotebook.contribution.ts`
- Verify when-clause matches expected context

3. Inspect context key scoping:
- Use "Inspect Context Keys" command
- Verify cell-level keys are scoped correctly
- Check if keys propagate to right DOM elements

**Common causes:**
- Context key not set when expected
- Scoping issue (key set on wrong element)
- When-clause logic incorrect
- Context key not updating after state change

## Debugging Workflows

### Debugging Cell Lifecycle

1. Set breakpoints:
   - `PositronNotebookInstance.addCell()`
   - `PositronNotebookCellGeneral` constructor
   - Cell component `useEffect` hooks

2. Create a new cell
3. Step through initialization
4. Verify observables set up correctly
5. Check React rendering

### Debugging Command Execution

1. Find command in `positronNotebook.contribution.ts`
2. Set breakpoint in command handler
3. Trigger command (menu, keyboard, or Command Palette)
4. Step through handler
5. Verify context keys checked correctly
6. Check state changes propagate

### Debugging React Rendering

1. Use React DevTools extension
2. Inspect component tree
3. Check props and state
4. Look for unnecessary re-renders
5. Verify observable updates trigger renders

### Debugging State Machine Transitions

1. Add logging to selection machine:
```typescript
// In selectionMachine.ts
this.onTransition(state => {
	console.log('[SelectionMachine] Transition', state.value, state.event);
});
```

2. Trigger selection events
3. Verify expected state transitions
4. Check context keys update with state

## Performance Debugging

### Identifying Slow Renders

1. Use React DevTools Profiler
2. Record interaction
3. Identify slow components
4. Check for unnecessary re-renders
5. Optimize observable subscriptions

### Memory Leaks

1. Take heap snapshot before opening notebook
2. Open/close notebook multiple times
3. Take another snapshot
4. Compare - look for retained instances
5. Check for undisposed observables/disposables

### Execution Queue Issues

1. Check runtime kernel queue state:
```typescript
this._logService.info('[Runtime Kernel] Queue', this._executionQueue);
```

2. Verify executions complete and clear
3. Check for stuck executions
4. Verify cancellation works

## Testing Strategies

### Unit Testing

**Location**: `src/vs/workbench/contrib/positronNotebook/test/browser/`

Focus areas:
- State management logic
- Selection machine transitions
- Cell lifecycle
- Observable behavior

Run tests:
```bash
npm test -- --grep "positronNotebook"
```

### E2E Testing

**Location**: `test/e2e/tests/notebook/`

Test scenarios:
- Visual behavior
- User interactions
- Execution flows
- Multi-cell operations

Run tests:
```bash
npx playwright test test/e2e/tests/notebook/ --project e2e-electron --reporter list
```

### Manual Testing Checklist

After making changes:
- [ ] Create new notebook
- [ ] Add code/markdown cells
- [ ] Execute cells
- [ ] Test selection (single, multi)
- [ ] Test keyboard shortcuts
- [ ] Test context menu commands
- [ ] Check output rendering
- [ ] Test kernel selection
- [ ] Verify focus management
- [ ] Check with large notebook (50+ cells)

## Known Issues and Workarounds

### Issue: Cell focus lost after execution
**Workaround**: Explicitly refocus cell after execution completes

### Issue: Context keys not updating immediately
**Workaround**: Use `setTimeout` or `queueMicrotask` to defer key updates

### Issue: Webview not mounting on first render
**Workaround**: Check webview mounting logic in `useWebviewMount.ts`

### Issue: Selection state out of sync with UI
**Workaround**: Verify event handlers fire and state machine transitions

## Debugging Resources

- Main architecture doc: `src/vs/workbench/contrib/positronNotebook/docs/positron_notebooks_architecture.md`
- VS Code notebook docs: `src/vs/workbench/contrib/notebook/`
- XState visualizer: https://stately.ai/viz (for selection machine)
