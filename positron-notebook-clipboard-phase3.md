# Phase 3: Context Menu Integration

## Objective
Add clipboard operations to the Positron notebook context menus, providing users with visual access to cut, copy, and paste functionality through right-click menus and cell toolbars.

## Background Context

### Current Menu System
VSCode uses a declarative menu contribution system where:
- Menus are identified by `MenuId` constants
- Menu items are registered via `MenuRegistry.appendMenuItem()`
- Actions extend `Action2` or specialized classes like `NotebookCellAction`
- Menu visibility is controlled by `when` clauses using context keys

### Positron Notebook UI Structure
Positron notebooks use React components, which may require a different approach:
- Cell components are rendered in React
- Context menus may need to be integrated with React event handlers
- Native VSCode menu system integration may require bridging

## Implementation Tasks

### Task 1: Create Clipboard Actions

**New File**: `src/vs/workbench/contrib/positronNotebook/browser/actions/clipboardActions.ts`

```typescript
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IPositronNotebookService } from '../../../../services/positronNotebook/browser/positronNotebookService.js';
import { 
    POSITRON_NOTEBOOK_EDITOR_FOCUSED,
    POSITRON_NOTEBOOK_HAS_CLIPBOARD_CELLS,
    POSITRON_NOTEBOOK_IS_READONLY
} from '../../../../services/positronNotebook/browser/ContextKeysManager.js';

// Define menu IDs for Positron notebooks
export const POSITRON_NOTEBOOK_CELL_CONTEXT_MENU = MenuId.for('positronNotebook.cellContextMenu');
export const POSITRON_NOTEBOOK_CELL_TOOLBAR = MenuId.for('positronNotebook.cellToolbar');

// Copy Cells Action
export class CopyCellsAction extends Action2 {
    constructor() {
        super({
            id: 'positronNotebook.copyCells',
            title: localize2('positronNotebook.copyCells', 'Copy Cells'),
            f1: true, // Show in command palette
            category: localize2('positronNotebook', 'Positron Notebook'),
            keybinding: {
                weight: KeybindingWeight.EditorContrib,
                primary: KeyMod.CtrlCmd | KeyCode.KeyC,
                when: POSITRON_NOTEBOOK_EDITOR_FOCUSED
            },
            menu: [
                {
                    id: POSITRON_NOTEBOOK_CELL_CONTEXT_MENU,
                    group: '2_clipboard',
                    order: 1,
                    when: POSITRON_NOTEBOOK_EDITOR_FOCUSED
                }
            ]
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const notebookService = accessor.get(IPositronNotebookService);
        const activeNotebook = notebookService.getActiveInstance();
        
        if (activeNotebook) {
            activeNotebook.copyCells();
        }
    }
}

// Cut Cells Action
export class CutCellsAction extends Action2 {
    constructor() {
        super({
            id: 'positronNotebook.cutCells',
            title: localize2('positronNotebook.cutCells', 'Cut Cells'),
            f1: true,
            category: localize2('positronNotebook', 'Positron Notebook'),
            keybinding: {
                weight: KeybindingWeight.EditorContrib,
                primary: KeyMod.CtrlCmd | KeyCode.KeyX,
                when: ContextKeyExpr.and(
                    POSITRON_NOTEBOOK_EDITOR_FOCUSED,
                    POSITRON_NOTEBOOK_IS_READONLY.negate()
                )
            },
            menu: [
                {
                    id: POSITRON_NOTEBOOK_CELL_CONTEXT_MENU,
                    group: '2_clipboard',
                    order: 2,
                    when: ContextKeyExpr.and(
                        POSITRON_NOTEBOOK_EDITOR_FOCUSED,
                        POSITRON_NOTEBOOK_IS_READONLY.negate()
                    )
                }
            ]
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const notebookService = accessor.get(IPositronNotebookService);
        const activeNotebook = notebookService.getActiveInstance();
        
        if (activeNotebook && !activeNotebook.isReadOnly) {
            activeNotebook.cutCells();
        }
    }
}

// Paste Cells Action
export class PasteCellsAction extends Action2 {
    constructor() {
        super({
            id: 'positronNotebook.pasteCells',
            title: localize2('positronNotebook.pasteCells', 'Paste Cells'),
            f1: true,
            category: localize2('positronNotebook', 'Positron Notebook'),
            keybinding: {
                weight: KeybindingWeight.EditorContrib,
                primary: KeyMod.CtrlCmd | KeyCode.KeyV,
                when: ContextKeyExpr.and(
                    POSITRON_NOTEBOOK_EDITOR_FOCUSED,
                    POSITRON_NOTEBOOK_HAS_CLIPBOARD_CELLS,
                    POSITRON_NOTEBOOK_IS_READONLY.negate()
                )
            },
            menu: [
                {
                    id: POSITRON_NOTEBOOK_CELL_CONTEXT_MENU,
                    group: '2_clipboard',
                    order: 3,
                    when: ContextKeyExpr.and(
                        POSITRON_NOTEBOOK_EDITOR_FOCUSED,
                        POSITRON_NOTEBOOK_HAS_CLIPBOARD_CELLS,
                        POSITRON_NOTEBOOK_IS_READONLY.negate()
                    )
                }
            ]
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const notebookService = accessor.get(IPositronNotebookService);
        const activeNotebook = notebookService.getActiveInstance();
        
        if (activeNotebook && !activeNotebook.isReadOnly && activeNotebook.canPaste()) {
            activeNotebook.pasteCells();
        }
    }
}

// Paste Cells Above Action
export class PasteCellsAboveAction extends Action2 {
    constructor() {
        super({
            id: 'positronNotebook.pasteCellsAbove',
            title: localize2('positronNotebook.pasteCellsAbove', 'Paste Cells Above'),
            f1: true,
            category: localize2('positronNotebook', 'Positron Notebook'),
            keybinding: {
                weight: KeybindingWeight.EditorContrib,
                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyV,
                when: ContextKeyExpr.and(
                    POSITRON_NOTEBOOK_EDITOR_FOCUSED,
                    POSITRON_NOTEBOOK_HAS_CLIPBOARD_CELLS,
                    POSITRON_NOTEBOOK_IS_READONLY.negate()
                )
            },
            menu: [
                {
                    id: POSITRON_NOTEBOOK_CELL_CONTEXT_MENU,
                    group: '2_clipboard',
                    order: 4,
                    when: ContextKeyExpr.and(
                        POSITRON_NOTEBOOK_EDITOR_FOCUSED,
                        POSITRON_NOTEBOOK_HAS_CLIPBOARD_CELLS,
                        POSITRON_NOTEBOOK_IS_READONLY.negate()
                    )
                }
            ]
        });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
        const notebookService = accessor.get(IPositronNotebookService);
        const activeNotebook = notebookService.getActiveInstance();
        
        if (activeNotebook && !activeNotebook.isReadOnly && activeNotebook.canPaste()) {
            activeNotebook.pasteCellsAbove();
        }
    }
}

// Register all actions
export function registerClipboardActions(): void {
    registerAction2(CopyCellsAction);
    registerAction2(CutCellsAction);
    registerAction2(PasteCellsAction);
    registerAction2(PasteCellsAboveAction);
}
```

### Task 2: Register Actions in Contribution File

**File**: `src/vs/workbench/contrib/positronNotebook/browser/positronNotebook.contribution.ts`

Add import and registration:

```typescript
import { registerClipboardActions } from './actions/clipboardActions.js';

// In the PositronNotebookContribution constructor or initialization
if (checkPositronNotebookEnabled(this.configurationService)) {
    this.registerEditor();
    registerClipboardActions(); // Add this line
}
```

### Task 3: Implement React Context Menu

Since Positron notebooks use React, we need to integrate with the React components:

**File**: `src/vs/workbench/contrib/positronNotebook/browser/components/CellContextMenu.tsx` (new)

```typescript
import * as React from 'react';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IAction } from '../../../../../base/common/actions.js';
import { IPositronNotebookCell } from '../../../../services/positronNotebook/browser/IPositronNotebookCell.js';
import { IPositronNotebookInstance } from '../../../../services/positronNotebook/browser/IPositronNotebookInstance.js';

interface CellContextMenuProps {
    cell: IPositronNotebookCell;
    instance: IPositronNotebookInstance;
    contextMenuService: IContextMenuService;
}

export class CellContextMenu {
    constructor(
        private readonly contextMenuService: IContextMenuService,
        private readonly instance: IPositronNotebookInstance
    ) {}

    show(event: React.MouseEvent, cell: IPositronNotebookCell): void {
        event.preventDefault();
        event.stopPropagation();

        const actions = this.getContextMenuActions(cell);
        
        this.contextMenuService.showContextMenu({
            getAnchor: () => ({ x: event.clientX, y: event.clientY }),
            getActions: () => actions,
            getActionViewItem: () => undefined,
            getKeyBinding: () => undefined,
            onHide: () => {
                // Cleanup if needed
            }
        });
    }

    private getContextMenuActions(cell: IPositronNotebookCell): IAction[] {
        const actions: IAction[] = [];

        // Copy action
        actions.push({
            id: 'positronNotebook.copyCells',
            label: 'Copy Cell',
            tooltip: 'Copy cell to clipboard',
            class: undefined,
            enabled: true,
            run: () => {
                this.instance.copyCells([cell]);
            }
        });

        // Cut action (only if not read-only)
        if (!this.instance.isReadOnly) {
            actions.push({
                id: 'positronNotebook.cutCells',
                label: 'Cut Cell',
                tooltip: 'Cut cell to clipboard',
                class: undefined,
                enabled: true,
                run: () => {
                    this.instance.cutCells([cell]);
                }
            });
        }

        // Separator
        actions.push({
            id: 'separator1',
            label: '',
            tooltip: '',
            class: 'separator',
            enabled: false,
            run: () => {}
        });

        // Paste actions (only if clipboard has content and not read-only)
        if (this.instance.canPaste() && !this.instance.isReadOnly) {
            actions.push({
                id: 'positronNotebook.pasteCells',
                label: 'Paste Cell Below',
                tooltip: 'Paste cells from clipboard below this cell',
                class: undefined,
                enabled: true,
                run: () => {
                    const cellIndex = this.instance.cells.get().indexOf(cell);
                    this.instance.pasteCells(cellIndex + 1);
                }
            });

            actions.push({
                id: 'positronNotebook.pasteCellsAbove',
                label: 'Paste Cell Above',
                tooltip: 'Paste cells from clipboard above this cell',
                class: undefined,
                enabled: true,
                run: () => {
                    const cellIndex = this.instance.cells.get().indexOf(cell);
                    this.instance.pasteCells(cellIndex);
                }
            });
        }

        return actions;
    }
}
```

### Task 4: Integrate Context Menu with Cell Components

**File**: Update the React cell component to handle right-click

```typescript
// In your cell component (location may vary)
import { CellContextMenu } from './CellContextMenu';

interface CellComponentProps {
    cell: IPositronNotebookCell;
    instance: IPositronNotebookInstance;
    // ... other props
}

export const CellComponent: React.FC<CellComponentProps> = ({ cell, instance, ...props }) => {
    const contextMenuService = useService(IContextMenuService);
    const contextMenu = React.useMemo(
        () => new CellContextMenu(contextMenuService, instance),
        [contextMenuService, instance]
    );

    const handleContextMenu = (event: React.MouseEvent) => {
        contextMenu.show(event, cell);
    };

    return (
        <div
            className="positron-notebook-cell"
            onContextMenu={handleContextMenu}
            // ... other props
        >
            {/* Cell content */}
        </div>
    );
};
```

### Task 5: Add Cell Toolbar Buttons (Optional)

**File**: Create toolbar button components

```typescript
// src/vs/workbench/contrib/positronNotebook/browser/components/CellToolbar.tsx

import * as React from 'react';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { IPositronNotebookCell } from '../../../../services/positronNotebook/browser/IPositronNotebookCell.js';
import { IPositronNotebookInstance } from '../../../../services/positronNotebook/browser/IPositronNotebookInstance.js';

interface CellToolbarProps {
    cell: IPositronNotebookCell;
    instance: IPositronNotebookInstance;
}

export const CellToolbar: React.FC<CellToolbarProps> = ({ cell, instance }) => {
    const canPaste = instance.canPaste();
    const isReadOnly = instance.isReadOnly;

    return (
        <div className="cell-toolbar">
            <button
                className="toolbar-button"
                title="Copy Cell (Ctrl+C)"
                onClick={() => instance.copyCells([cell])}
                aria-label="Copy Cell"
            >
                <span className="codicon codicon-copy" />
            </button>
            
            {!isReadOnly && (
                <button
                    className="toolbar-button"
                    title="Cut Cell (Ctrl+X)"
                    onClick={() => instance.cutCells([cell])}
                    aria-label="Cut Cell"
                >
                    <span className="codicon codicon-scissors" />
                </button>
            )}
            
            {!isReadOnly && canPaste && (
                <button
                    className="toolbar-button"
                    title="Paste Cell (Ctrl+V)"
                    onClick={() => {
                        const cellIndex = instance.cells.get().indexOf(cell);
                        instance.pasteCells(cellIndex + 1);
                    }}
                    aria-label="Paste Cell"
                >
                    <span className="codicon codicon-paste" />
                </button>
            )}
        </div>
    );
};
```

### Task 6: Add Styles for Menu Items

**File**: `src/vs/workbench/contrib/positronNotebook/browser/media/notebook.css`

```css
/* Context menu styles */
.positron-notebook-cell-context-menu {
    /* Inherit from monaco-menu styles */
}

.cell-toolbar {
    display: flex;
    gap: 4px;
    padding: 4px;
    opacity: 0;
    transition: opacity 0.2s;
}

.positron-notebook-cell:hover .cell-toolbar,
.positron-notebook-cell.selected .cell-toolbar {
    opacity: 1;
}

.toolbar-button {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px;
    border-radius: 3px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

.toolbar-button:hover {
    background-color: var(--vscode-toolbar-hoverBackground);
}

.toolbar-button:active {
    background-color: var(--vscode-toolbar-activeBackground);
}

.toolbar-button[disabled] {
    opacity: 0.4;
    cursor: not-allowed;
}
```

## Menu Organization

### Menu Groups
Organize clipboard operations in logical groups:

```typescript
enum MenuGroups {
    Navigation = '1_navigation',
    Clipboard = '2_clipboard',
    Edit = '3_edit',
    Cell = '4_cell',
    Output = '5_output'
}
```

### Menu Order
Within the clipboard group:
1. Copy (order: 1)
2. Cut (order: 2)  
3. Paste (order: 3)
4. Paste Above (order: 4)

## Accessibility Considerations

### Keyboard Navigation
- Ensure all menu items are keyboard accessible
- Support arrow key navigation in context menus
- Provide keyboard shortcuts in menu item labels

### Screen Reader Support
- Add appropriate ARIA labels
- Include role attributes for menu items
- Provide descriptive tooltips

### Visual Indicators
- Show keyboard shortcuts in menu items
- Provide visual feedback for disabled items
- Use consistent icons from VS Code's icon library

## Testing Checklist

### Context Menu Tests
1. Right-click on a cell shows context menu
2. Copy option is always visible
3. Cut option hidden in read-only notebooks
4. Paste options appear only when clipboard has content
5. Menu items execute correct actions
6. Menu dismisses after action execution

### Toolbar Tests
1. Toolbar appears on cell hover
2. Buttons have correct tooltips
3. Disabled state is visually distinct
4. Click actions work correctly
5. Toolbar respects read-only state

### Integration Tests
1. Context menu actions trigger same code as keyboard shortcuts
2. State updates correctly after menu actions
3. Multiple cells can be operated on via selection
4. Undo/redo works with menu actions

### Accessibility Tests
1. Menu items accessible via keyboard
2. Screen reader announces menu items correctly
3. Focus management works properly
4. High contrast theme compatibility

## Platform-Specific Considerations

### macOS
- Right-click and Ctrl+click both show context menu
- Native menu styling if possible

### Windows/Linux
- Right-click shows context menu
- Menu key on keyboard also triggers menu

## Performance Optimization

### Lazy Loading
- Only create menu items when needed
- Cache menu structure if possible

### Event Handling
- Use event delegation for multiple cells
- Avoid creating multiple event listeners

### React Optimization
- Use React.memo for toolbar components
- Implement shouldComponentUpdate where appropriate

## Error Handling

### User Feedback
```typescript
// Show notification for clipboard errors
if (!success) {
    notificationService.error(
        localize('clipboard.error', 'Failed to {0} cells', operation)
    );
}
```

### Graceful Degradation
- If native menu fails, fall back to HTML menu
- Handle clipboard API permissions issues

## Integration with Existing Menus

### Coordinate with VSCode Notebooks
- Ensure menu IDs don't conflict
- Consider shared menu contributions where appropriate

### Future Extensibility
- Design menu system to support extensions
- Allow third-party menu contributions

## Next Phase Prerequisites

Before moving to Phase 4 (Testing and Validation), ensure:
1. ✅ Context menu appears on right-click
2. ✅ All clipboard operations available in menu
3. ✅ Menu items properly enabled/disabled based on state
4. ✅ Toolbar buttons functional (if implemented)
5. ✅ Accessibility requirements met
6. ✅ Visual styling matches VS Code design language