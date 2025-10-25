# Common Patterns and Solutions

Code patterns and examples for common notebook development tasks.

## Adding a New Command

**Pattern**: Register command, add to menu, implement handler

```typescript
// In positronNotebook.contribution.ts

// 1. Register command
CommandsRegistry.registerCommand({
	id: 'positronNotebook.myNewCommand',
	handler: (accessor, ...args) => {
		const notebookService = accessor.get(IPositronNotebookService);
		const instance = notebookService.getActiveInstance();
		if (!instance) {
			return;
		}

		// Implementation
		const selectedCells = instance.getSelectedCells();
		// ... do something with cells
	}
});

// 2. Add to menu (optional)
MenuRegistry.appendMenuItem(MenuId.NotebookCellTitle, {
	command: {
		id: 'positronNotebook.myNewCommand',
		title: 'My New Command'
	},
	when: ContextKeyExpr.and(
		ContextKeyExpr.equals('positronNotebookEditorFocused', true),
		// Add more conditions
	),
	group: 'inline'
});

// 3. Add keybinding (optional)
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'positronNotebook.myNewCommand',
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(
		ContextKeyExpr.equals('positronNotebookEditorFocused', true)
	),
	primary: KeyMod.CtrlCmd | KeyCode.KeyK,
	handler: () => { /* handled by CommandsRegistry */ }
});
```

## Adding Cell State

**Pattern**: Observable in cell model, consume in React

```typescript
// In PositronNotebookCellGeneral.ts (or specific cell class)

export class PositronNotebookCodeCell implements IPositronNotebookCell {
	// Add observable
	private readonly _myState = observableValue<string>('myState', 'initial');
	public readonly myStateObservable: IObservable<string> = this._myState;

	// Add method to update state
	public setMyState(value: string): void {
		this._myState.set(value, undefined);
	}
}

// In React component (e.g., NotebookCodeCell.tsx)
function NotebookCodeCell({ cell }: { cell: IPositronNotebookCell }) {
	const myState = useObservedValue(cell.myStateObservable);

	return <div>State: {myState}</div>;
}
```

## Accessing Services in React

**Pattern**: Use React context to access VS Code services

```typescript
// Services are provided via PositronNotebookContextProvider

import { usePositronNotebookContext } from './positronNotebookContext';

function MyComponent() {
	const context = usePositronNotebookContext();
	const instance = context.instance;

	const handleClick = () => {
		instance.executeCell(cellUri);
	};

	return <button onClick={handleClick}>Execute</button>;
}
```

## Adding Context Keys

**Pattern**: Define key, set in ContextKeysManager, use in when-clauses

```typescript
// In ContextKeysManager.ts

export class ContextKeysManager extends Disposable {
	private readonly _myNewKey: IContextKey<boolean>;

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
		super();

		// Create key
		this._myNewKey = CONTEXT_MY_NEW_KEY.bindTo(this.contextKeyService);
	}

	public setMyNewKey(value: boolean): void {
		this._myNewKey.set(value);
	}
}

// Define context key constant
export const CONTEXT_MY_NEW_KEY = new RawContextKey<boolean>('positronNotebook.myNewKey', false);

// Use in when-clause
MenuRegistry.appendMenuItem(MenuId.NotebookCellTitle, {
	command: { id: 'myCommand', title: 'My Command' },
	when: ContextKeyExpr.equals('positronNotebook.myNewKey', true)
});
```

## Handling Cell Execution

**Pattern**: Cancel previous, start new, handle outputs

```typescript
// In PositronNotebookInstance.ts

public async executeCell(cellUri: URI): Promise<void> {
	const cell = this.getCell(cellUri);
	if (!cell) {
		return;
	}

	// 1. Cancel any existing execution
	const existingExecution = this._notebookExecutionStateService.getCellExecution(cellUri);
	if (existingExecution) {
		await existingExecution.cancel();
	}

	// 2. Start new execution
	const kernel = this._notebookKernelService.getSelectedOrSuggestedKernel(this._notebookModel);
	if (!kernel) {
		this._logService.warn('[Positron Notebook] No kernel selected');
		return;
	}

	// 3. Execute via service
	await this._notebookExecutionService.executeNotebookCells(
		this._notebookModel,
		[{ start: cell.cellIndex, end: cell.cellIndex + 1 }],
		kernel
	);

	// 4. Outputs will arrive via execution state service events
	// Cell model updates automatically via observable
}
```

## Adding UI Component

**Pattern**: Create React component, integrate with cell or editor

```typescript
// In notebookCells/MyNewComponent.tsx

import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell';
import { useObservedValue } from 'vs/base/browser/ui/positronComponents/useObservedValue';

export function MyNewComponent({ cell }: { cell: IPositronNotebookCell }) {
	const executionState = useObservedValue(cell.executionStateObservable);
	const selected = useObservedValue(cell.selectedObservable);

	return (
		<div className={`my-component ${selected ? 'selected' : ''}`}>
			{executionState === NotebookCellExecutionState.Executing && (
				<span>Executing...</span>
			)}
		</div>
	);
}

// Add to parent component
import { MyNewComponent } from './MyNewComponent';

function NotebookCodeCell({ cell }: { cell: IPositronNotebookCell }) {
	return (
		<div>
			<MyNewComponent cell={cell} />
			{/* other components */}
		</div>
	);
}
```

## Testing Patterns

### Unit Test Pattern

```typescript
// In test/browser/myFeature.test.ts

import * as assert from 'assert';
import { PositronNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance';

suite('Positron Notebook - My Feature', () => {
	test('should do something', async () => {
		// Arrange
		const instance = createTestInstance(); // Helper to create instance
		const cell = instance.getCell(0);

		// Act
		instance.selectCell(cell.uri);

		// Assert
		assert.strictEqual(cell.selectedObservable.get(), true);
	});
});
```

### E2E Test Pattern

```typescript
// In test/e2e/tests/notebook/myFeature.test.ts

import { test, expect } from '@playwright/test';
import { Application } from '../../infra';

test.describe('Notebook - My Feature', () => {
	test('should do something in UI', async function ({ app }) {
		// Open notebook
		await app.workbench.positronNotebook.openNotebook('test.ipynb');

		// Interact with UI
		await app.workbench.positronNotebook.clickCell(0);
		await app.workbench.positronNotebook.executeCell(0);

		// Assert
		const output = await app.workbench.positronNotebook.getCellOutput(0);
		expect(output).toContain('expected result');
	});
});
```

## Selection State Machine

**Pattern**: Send events to trigger transitions

```typescript
// In PositronNotebookInstance.ts

public selectCell(cellUri: URI, extendSelection: boolean = false): void {
	const cell = this.getCell(cellUri);
	if (!cell) {
		return;
	}

	// Send event to state machine
	if (extendSelection) {
		this._selectionMachine.send({
			type: 'EXTEND_SELECTION',
			cellUri
		});
	} else {
		this._selectionMachine.send({
			type: 'SELECT_CELL',
			cellUri
		});
	}

	// State machine updates cell selection observables
	// React components re-render automatically
}
```

## Observable Patterns

### Derived Observable

```typescript
// Compute value from other observables
const isExecuting = derived(reader => {
	const state = cell.executionStateObservable.read(reader);
	return state === NotebookCellExecutionState.Executing;
});
```

### Observable with Transaction

```typescript
// Update multiple observables atomically
transaction(tx => {
	cell1._selected.set(true, tx);
	cell2._selected.set(false, tx);
	// Both updates happen at once, single React re-render
});
```

### Subscribing to Observable in Disposable

```typescript
export class MyClass extends Disposable {
	constructor(cell: IPositronNotebookCell) {
		super();

		// Subscribe with automatic disposal
		this._register(autorun(reader => {
			const selected = cell.selectedObservable.read(reader);
			if (selected) {
				// Do something when selected
			}
		}));
	}
}
```

## Webview Integration

**Pattern**: Register preload, mount webview, handle lifecycle

```typescript
// Register preload (in contribution)
this._positronWebviewPreloadService.registerPreload(
	'myOutputType',
	URI.file(path.join(__dirname, 'myPreload.js'))
);

// Mount webview (in React component)
import { useWebviewMount } from './hooks/useWebviewMount';

function MyOutput({ output }: { output: INotebookOutput }) {
	const containerRef = useRef<HTMLDivElement>(null);

	useWebviewMount(containerRef, output, {
		// Webview options
	});

	return <div ref={containerRef} />;
}
```

## Error Handling Pattern

```typescript
public async myOperation(): Promise<void> {
	try {
		// Operation
		await this.doSomething();
	} catch (error) {
		this._logService.error('[Positron Notebook] Operation failed', error);
		// Optionally show notification
		this._notificationService.error(`Operation failed: ${error.message}`);
	}
}
```

## Disposal Pattern

```typescript
export class MyClass extends Disposable {
	private readonly _disposables = new DisposableStore();

	constructor() {
		super();

		// Register disposables
		this._register(this._disposables);

		// Add disposables to store
		this._disposables.add(someDisposable);
		this._disposables.add(anotherDisposable);
	}

	public dispose(): void {
		// Automatically disposes everything in _disposables
		super.dispose();
	}
}
```
