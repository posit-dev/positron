/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { WorkbenchPhase, IWorkbenchContribution, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';

import { parse } from '../../../../base/common/marshalling.js';
import { assertType } from '../../../../base/common/types.js';
import { INotebookService } from '../../notebook/common/notebookService.js';

import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorResolverService, RegisteredEditorInfo, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { PositronNotebookEditor } from './PositronNotebookEditor.js';
import { PositronNotebookEditorInput, PositronNotebookEditorInputOptions } from './PositronNotebookEditorInput.js';
import { NotebookDiffEditorInput } from '../../notebook/common/notebookDiffEditorInput.js';

import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { checkPositronNotebookEnabled } from './positronNotebookExperimentalConfig.js';
import { IWorkingCopyEditorHandler, IWorkingCopyEditorService } from '../../../services/workingCopy/common/workingCopyEditorService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkingCopyIdentifier } from '../../../services/workingCopy/common/workingCopy.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { isEqual } from '../../../../base/common/resources.js';
import { CellKind, CellUri, NotebookWorkingCopyTypeIdentifier } from '../../notebook/common/notebookCommon.js';
import { registerCellCommand } from './notebookCells/actionBar/registerCellCommand.js';
import { registerNotebookAction } from './registerNotebookAction.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { INotebookEditorOptions } from '../../notebook/browser/notebookBrowser.js';
import { POSITRON_NOTEBOOK_EDITOR_ID, POSITRON_NOTEBOOK_EDITOR_INPUT_ID } from '../common/positronNotebookCommon.js';
import { SelectionState } from './selectionMachine.js';
import { POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS as CELL_CONTEXT_KEYS, POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED } from './ContextKeysManager.js';
import './contrib/undoRedo/positronNotebookUndoRedo.js';
import { registerAction2, MenuId } from '../../../../platform/actions/common/actions.js';
import { ExecuteSelectionInConsoleAction } from './ExecuteSelectionInConsoleAction.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { KernelStatusBadge } from './KernelStatusBadge.js';


/**
 * PositronNotebookContribution class.
 */
class PositronNotebookContribution extends Disposable {
	static readonly ID = 'workbench.contrib.positronNotebookContribution';

	constructor(
		@IEditorResolverService private readonly editorResolverService: IEditorResolverService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IFileService private readonly fileService: IFileService,
		@INotebookService private readonly notebookService: INotebookService
	) {
		super();

		// Only register the editor if the feature is enabled
		if (checkPositronNotebookEnabled(this.configurationService)) {
			this.registerEditor();
		}
	}

	private registerEditor(): void {
		const notebookEditorInfo: RegisteredEditorInfo = {
			id: POSITRON_NOTEBOOK_EDITOR_ID,
			label: localize('positronNotebook', "Positron Notebook"),
			detail: localize('positronNotebook.detail', "Provided by Positron"),
			priority: RegisteredEditorPriority.option
		};

		// Register for .ipynb files
		this._register(this.editorResolverService.registerEditor(
			'*.ipynb',
			notebookEditorInfo,
			{
				singlePerResource: true,
				canSupportResource: (resource: URI) => {
					// Support untitled notebooks and any file system that has a provider
					// This handles: file://, vscode-remote://, vscode-userdata://, etc.
					return resource.scheme === Schemas.untitled ||
						resource.scheme === Schemas.vscodeNotebookCell ||
						this.fileService.hasProvider(resource);
				}
			},
			{
				createUntitledEditorInput: async ({ resource, options }) => {
					// We should handle undefined resource as in notebookEditorServiceImpl.ts,
					// but resource seems to always be defined so we throw for now to simplify
					if (!resource) {
						throw new Error(`Cannot create untitled Positron notebook editor without a resource`);
					}
					const notebookEditorInput = PositronNotebookEditorInput.getOrCreate(
						this.instantiationService,
						resource,
						undefined,
					);
					return { editor: notebookEditorInput, options };
				},
				createEditorInput: ({ resource, options }) => {
					const notebookEditorInput = PositronNotebookEditorInput.getOrCreate(
						this.instantiationService,
						resource,
						undefined,
					);
					return { editor: notebookEditorInput, options };
				},
				// Positron notebook editor doesn't support diff views, so delegate to VSCode's notebook diff editor
				createDiffEditorInput: ({ original, modified, label, description }, group) => {
					if (!modified.resource || !original.resource) {
						throw new Error('Cannot create notebook diff editor without resources');
					}

					// Determine the notebook view type for the resource
					// First try to get it from an existing model
					let viewType = this.notebookService.getNotebookTextModel(modified.resource)?.viewType;

					// If no model exists, find matching contributed notebook types
					if (!viewType) {
						const providers = this.notebookService.getContributedNotebookTypes(modified.resource);
						// Use exclusive or default provider, or fall back to first available
						viewType = providers.find(p => p.priority === 'exclusive')?.id
							|| providers.find(p => p.priority === 'default')?.id
							|| providers[0]?.id;
					}

					if (!viewType) {
						throw new Error(`Cannot determine notebook view type for resource: ${modified.resource}`);
					}

					const diffInput = NotebookDiffEditorInput.create(
						this.instantiationService,
						modified.resource,
						label,
						description,
						original.resource,
						viewType
					);
					return { editor: diffInput };
				}
			},
		));

		// Register for cells in .ipynb files
		this._register(this.editorResolverService.registerEditor(
			`${Schemas.vscodeNotebookCell}:/**/*.ipynb`,
			// The cell handler is specifically for opening and focusing a cell by URI
			// e.g. vscode.window.showTextDocument(cell.document).
			// The editor resolver service expects a single handler with 'exclusive' priority.
			// This one is only registered if Positron notebooks are enabled.
			// This does not seem to be an issue for file schemes (registered above).
			{ ...notebookEditorInfo, priority: RegisteredEditorPriority.exclusive },
			{
				singlePerResource: true,
				canSupportResource: (resource: URI) => {
					return resource.scheme === Schemas.vscodeNotebookCell;
				}
			},
			{
				createEditorInput: (editorInput) => {
					const parsed = CellUri.parse(editorInput.resource);
					if (!parsed) {
						throw new Error(`Invalid cell URI: ${editorInput.resource.toString()}`);
					}
					const notebookEditorInput = PositronNotebookEditorInput.getOrCreate(
						this.instantiationService,
						parsed.notebook,
						undefined,
					);
					// Create notebook editor options from base text editor options
					const notebookEditorOptions: INotebookEditorOptions = {
						...editorInput.options,
						cellOptions: editorInput,
						// Override text editor view state - it's not valid for notebook editors
						viewState: undefined,
					};
					return { editor: notebookEditorInput, options: notebookEditorOptions };
				}
			},
		));
	}
}

/**
 * PositronNotebookWorkingCopyEditorHandler class.
 * Handles backup restoration for Positron notebooks.
 */
class PositronNotebookWorkingCopyEditorHandler extends Disposable implements IWorkbenchContribution, IWorkingCopyEditorHandler {

	static readonly ID = 'workbench.contrib.positronNotebookWorkingCopyEditorHandler';

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkingCopyEditorService private readonly workingCopyEditorService: IWorkingCopyEditorService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@INotebookService private readonly notebookService: INotebookService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();

		// Only install handler if Positron notebooks are enabled
		if (checkPositronNotebookEnabled(this.configurationService)) {
			this.installHandler();
		}
	}

	private async installHandler(): Promise<void> {
		await this.extensionService.whenInstalledExtensionsRegistered();
		this._register(this.workingCopyEditorService.registerHandler(this));
	}

	async handles(workingCopy: IWorkingCopyIdentifier): Promise<boolean> {
		// Only handle .ipynb files when Positron notebooks are enabled
		if (!workingCopy.resource.path.endsWith('.ipynb')) {
			return false;
		}

		if (!checkPositronNotebookEnabled(this.configurationService)) {
			return false;
		}

		const viewType = this.getViewType(workingCopy);
		if (!viewType || viewType === 'interactive') {
			return false;
		}

		return this.notebookService.canResolve(viewType);
	}

	isOpen(workingCopy: IWorkingCopyIdentifier, editor: EditorInput): boolean {
		const viewType = this.getViewType(workingCopy);
		if (!viewType) {
			return false;
		}

		// Check if this is a Positron notebook editor for the same resource
		return editor instanceof PositronNotebookEditorInput &&
			editor.viewType === viewType &&
			isEqual(workingCopy.resource, editor.resource);
	}

	createEditor(workingCopy: IWorkingCopyIdentifier): EditorInput {
		return PositronNotebookEditorInput.getOrCreate(
			this.instantiationService,
			workingCopy.resource,
			undefined,
			{
				// Mark as dirty since we're restoring from a backup
				startDirty: true,
				_workingCopy: workingCopy
			}
		);
	}

	private getViewType(workingCopy: IWorkingCopyIdentifier): string | undefined {
		const notebookType = NotebookWorkingCopyTypeIdentifier.parse(workingCopy.typeId);
		if (notebookType && notebookType.viewType === notebookType.notebookType) {
			return notebookType.viewType;
		}
		return undefined;
	}
}

// Register the Positron notebook editor pane.
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PositronNotebookEditor,
		POSITRON_NOTEBOOK_EDITOR_ID,
		localize('positronNotebookEditor', "Positron Notebook Editor")
	),
	[
		new SyncDescriptor(PositronNotebookEditorInput)
	]
);

// Register workbench contributions.
registerWorkbenchContribution2(PositronNotebookContribution.ID, PositronNotebookContribution, WorkbenchPhase.AfterRestored);

// Register the working copy handler for backup restoration
registerWorkbenchContribution2(PositronNotebookWorkingCopyEditorHandler.ID, PositronNotebookWorkingCopyEditorHandler, WorkbenchPhase.BlockRestore);



type SerializedPositronNotebookEditorData = { resource: URI; options?: PositronNotebookEditorInputOptions };
class PositronNotebookEditorSerializer implements IEditorSerializer {
	canSerialize(): boolean {
		return true;
	}
	serialize(input: EditorInput): string {
		assertType(input instanceof PositronNotebookEditorInput);
		const data: SerializedPositronNotebookEditorData = {
			resource: input.resource,
			options: input.options
		};
		return JSON.stringify(data);
	}
	deserialize(instantiationService: IInstantiationService, raw: string) {
		const data = <SerializedPositronNotebookEditorData>parse(raw);
		if (!data) {
			return undefined;
		}
		const { resource, options } = data;
		if (!data || !URI.isUri(resource)) {
			return undefined;
		}

		const input = PositronNotebookEditorInput.getOrCreate(instantiationService, resource, undefined, options);
		return input;
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	POSITRON_NOTEBOOK_EDITOR_INPUT_ID,
	PositronNotebookEditorSerializer
);


//#region Notebook Commands
registerNotebookAction({
	commandId: 'positronNotebook.selectUp',
	handler: (notebook) => notebook.selectionStateMachine.moveSelectionUp(false),
	keybinding: {
		primary: KeyCode.UpArrow,
		secondary: [KeyCode.KeyK]
	},
	metadata: {
		description: localize('positronNotebook.selectUp', "Move focus up")
	}
});

registerNotebookAction({
	commandId: 'positronNotebook.selectDown',
	handler: (notebook) => notebook.selectionStateMachine.moveSelectionDown(false),
	keybinding: {
		primary: KeyCode.DownArrow,
		secondary: [KeyCode.KeyJ]
	},
	metadata: {
		description: localize('positronNotebook. selectDown', "Move focus down")
	}
});

registerNotebookAction({
	commandId: 'positronNotebook.addSelectionDown',
	handler: (notebook) => notebook.selectionStateMachine.moveSelectionDown(true),
	keybinding: {
		primary: KeyMod.Shift | KeyCode.DownArrow,
		secondary: [KeyMod.Shift | KeyCode.KeyJ]
	},
	metadata: {
		description: localize('positronNotebook.addSelectionDown', "Extend selection down")
	}
});

registerNotebookAction({
	commandId: 'positronNotebook.addSelectionUp',
	handler: (notebook) => notebook.selectionStateMachine.moveSelectionUp(true),
	keybinding: {
		primary: KeyMod.Shift | KeyCode.UpArrow,
		secondary: [KeyMod.Shift | KeyCode.KeyK]
	},
	metadata: {
		description: localize('positronNotebook.addSelectionUp', "Extend selection up")
	}
});

// Enter key: Enter edit mode when cell is selected but NOT editing
registerNotebookAction({
	commandId: 'positronNotebook.cell.edit',
	handler: (notebook) => {
		notebook.selectionStateMachine.enterEditor().catch(err => {
			console.error('Error entering editor:', err);
		});
	},
	keybinding: {
		primary: KeyCode.Enter
	},
	when: POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED.toNegated(),
	metadata: {
		description: localize('positronNotebook.cell.edit', "Enter cell edit mode")
	}
});

// Escape key: Exit edit mode when cell editor is focused
registerNotebookAction({
	commandId: 'positronNotebook.cell.quitEdit',
	handler: (notebook) => {
		notebook.selectionStateMachine.exitEditor();
	},
	keybinding: {
		primary: KeyCode.Escape,
		when: POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED
	},
	metadata: {
		description: localize('positronNotebook.cell.quitEdit', "Exit cell edit mode")
	}
});

//#endregion Notebook Commands

//#region Cell Commands
// Register delete command with UI in one call
// For built-in commands, we don't need to manage the disposable since they live
// for the lifetime of the application

registerCellCommand({
	commandId: 'positronNotebook.cell.insertCodeCellAboveAndFocusContainer',
	handler: (cell) => cell.insertCodeCellAbove(),
	keybinding: {
		primary: KeyCode.KeyA
	},
	actionBar: {
		icon: 'codicon-arrow-up',
		position: 'menu',
		order: 100,
		category: 'Cell'
	},
	metadata: {
		description: localize('positronNotebook.cell.insertAbove', "Insert code cell above")
	}
});

registerCellCommand({
	commandId: 'positronNotebook.cell.insertCodeCellBelowAndFocusContainer',
	handler: (cell) => cell.insertCodeCellBelow(),
	keybinding: {
		primary: KeyCode.KeyB
	},
	actionBar: {
		icon: 'codicon-arrow-down',
		position: 'menu',
		order: 100,
		category: 'Cell'
	},
	metadata: {
		description: localize('positronNotebook.cell.insertBelow', "Insert code cell below")
	}
});

registerCellCommand({
	commandId: 'positronNotebook.cell.delete',
	handler: (cell) => cell.delete(),
	multiSelect: true,  // Delete all selected cells
	editMode: false,
	actionBar: {
		icon: 'codicon-trash',
		position: 'mainRight',
		order: 100,
		category: 'Cell'
	},
	keybinding: {
		primary: KeyCode.Backspace,
		secondary: [KeyChord(KeyCode.KeyD, KeyCode.KeyD)]
	},
	metadata: {
		description: localize('positronNotebook.cell.delete.description', "Delete the selected cell(s)"),
	}
}
);

// Make sure the run and stop commands are in the same place so they replace one another.
const CELL_EXECUTION_POSITION = 10;
registerCellCommand({
	commandId: 'positronNotebook.cell.execute',
	handler: (cell) => {
		cell.run();
	},
	when: ContextKeyExpr.and(
		CELL_CONTEXT_KEYS.isCode.isEqualTo(true),
		CELL_CONTEXT_KEYS.isRunning.toNegated(),
		CELL_CONTEXT_KEYS.isPending.toNegated()
	),
	actionBar: {
		icon: 'codicon-play',
		position: 'left',
		order: CELL_EXECUTION_POSITION,
		category: 'Execution',
	},
	metadata: {
		description: localize('positronNotebook.cell.execute', "Execute cell")
	}
});

registerCellCommand({
	commandId: 'positronNotebook.cell.stopExecution',
	handler: (cell) => cell.run(), // Run called when cell is executing is stop
	when: ContextKeyExpr.and(
		CELL_CONTEXT_KEYS.isCode.isEqualTo(true),
		ContextKeyExpr.or(
			CELL_CONTEXT_KEYS.isRunning.isEqualTo(true),
			CELL_CONTEXT_KEYS.isPending.isEqualTo(true)
		)
	),
	actionBar: {
		icon: 'codicon-primitive-square',
		position: 'left',
		order: CELL_EXECUTION_POSITION,
		category: 'Execution',
	},
	metadata: {
		description: localize('positronNotebook.cell.stopExecution', "Stop cell execution")
	}
});

// Run all code cells above the current cell
registerCellCommand({
	commandId: 'positronNotebook.cell.runAllAbove',
	handler: (cell, notebook) => {
		const cells = notebook.cells.get();

		// Run all code cells above the current cell
		const cellIndex = cell.index;
		for (let i = 0; i < cellIndex; i++) {
			const targetCell = cells[i];
			if (targetCell.isCodeCell()) {
				targetCell.run();
			}
		}
	},
	when: ContextKeyExpr.and(
		CELL_CONTEXT_KEYS.isCode.isEqualTo(true),
		CELL_CONTEXT_KEYS.isFirst.toNegated()
	),
	actionBar: {
		icon: 'codicon-run-above',
		position: 'main',
		order: 20,
		category: 'Execution',
	},
	metadata: {
		description: localize('positronNotebook.cell.runAllAbove', "Run all code cells above this cell")
	}
});

// Run all code cells below the current cell
registerCellCommand({
	commandId: 'positronNotebook.cell.runAllBelow',
	handler: (cell, notebook) => {
		if (!notebook) { return; }

		const cells = notebook.cells.get();

		// Run all code cells below the current cell
		for (let i = cell.index + 1; i < cells.length; i++) {
			const targetCell = cells[i];
			if (targetCell.isCodeCell()) {
				targetCell.run();
			}
		}
	},
	when: ContextKeyExpr.and(
		CELL_CONTEXT_KEYS.isCode.isEqualTo(true),
		CELL_CONTEXT_KEYS.isLast.toNegated()
	),
	actionBar: {
		icon: 'codicon-run-below',
		position: 'main',
		order: 21,
		category: 'Execution',
	},
	metadata: {
		description: localize('positronNotebook.cell.runAllBelow', "Run all code cells below this cell")
	}
});

// Open markdown editor (For action bar)
registerCellCommand({
	commandId: 'positronNotebook.cell.openMarkdownEditor',
	handler: (cell) => {
		if (cell.isMarkdownCell()) {
			// This test is just to appease typescript, we know it's a markdown cell
			cell.toggleEditor();
		}
	},
	when: ContextKeyExpr.and(
		CELL_CONTEXT_KEYS.isMarkdown.isEqualTo(true),
		CELL_CONTEXT_KEYS.markdownEditorOpen.toNegated()
	),
	actionBar: {
		icon: 'codicon-chevron-down',
		position: 'main',
		order: 10,
		category: 'Markdown',
	},
	metadata: {
		description: localize('positronNotebook.cell.openMarkdownEditor', "Open markdown editor")
	}
});


// Collapse markdown editor (For action bar)
registerCellCommand({
	commandId: 'positronNotebook.cell.collapseMarkdownEditor',
	handler: (cell) => {
		if (cell.isMarkdownCell()) {
			// This test is just to appease typescript, we know it's a markdown cell
			cell.toggleEditor();
		}
	},
	when: ContextKeyExpr.and(
		CELL_CONTEXT_KEYS.isMarkdown.isEqualTo(true),
		CELL_CONTEXT_KEYS.markdownEditorOpen.isEqualTo(true)
	),
	actionBar: {
		icon: 'codicon-chevron-up',
		position: 'main',
		order: 10,
		category: 'Markdown',
	},
	metadata: {
		description: localize('positronNotebook.cell.collapseMarkdownEditor', "Collapse markdown editor")
	}
});


// Keyboard shortcut commands. These are not shown in the action bar.
// TODO: Improve the context key support so we don't need to have a single command per
// the keyboard shortcut and can reuse the action bar commands. Cell agnostic
// "Execute in place" command.
registerCellCommand({
	commandId: 'positronNotebook.cell.executeOrToggleEditor',
	handler: (cell) => {
		if (cell.isMarkdownCell()) {
			cell.toggleEditor();
		} else {
			// This also stops if the cell is running.
			cell.run();
		}
	},
	editMode: true,  // Allow command to work when focus is in the cell editor
	keybinding: {
		primary: KeyMod.CtrlCmd | KeyCode.Enter
	},
	metadata: {
		description: localize('positronNotebook.cell.executeOrToggleEditor', "Execute cell or toggle editor")
	}
});


// Execute cell and select below
registerCellCommand({
	commandId: 'positronNotebook.cell.executeAndSelectBelow',
	handler: (cell, notebook) => {
		// Check if we're in edit mode and exit if so
		const state = notebook.selectionStateMachine.state.get();
		if (state.type === SelectionState.EditingSelection) {
			notebook.selectionStateMachine.exitEditor();
		}

		// Execute the cell only if it's a code cell. Otherwise the user would
		// have to double call for markdown cells to open and then close the
		// editor.
		if (cell.isCodeCell()) {
			cell.run();
		}

		// If the cell is a markdown cell and the editor is open, close it. Otherwise just pass over.
		if (cell.isMarkdownCell() && cell.editorShown.get()) {
			cell.toggleEditor();
		}

		// If this is the last cell, insert a new cell below of the same type
		if (cell.isLastCell()) {
			notebook.addCell(cell.kind, cell.index + 1);
			// Don't call moveDown - addCell triggers SelectionStateMachine._setCells()
			// which already handles selection and focus of the new cell in Edit mode
		} else {
			// Only move down if we didn't add a cell
			notebook.selectionStateMachine.moveSelectionDown(false);
		}
	},
	editMode: true,  // Allow execution from edit mode
	keybinding: {
		primary: KeyMod.Shift | KeyCode.Enter
	},
	metadata: {
		description: localize('positronNotebook.cell.executeAndSelectBelow', "Execute cell and select below")
	}
});

// Copy cells command - Cmd/Ctrl+C
registerCellCommand({
	commandId: 'positronNotebook.copyCells',
	handler: (cell, notebook) => notebook.copyCells(),
	multiSelect: true,  // Copy all selected cells
	keybinding: {
		primary: KeyMod.CtrlCmd | KeyCode.KeyC,
		mac: {
			primary: KeyMod.CtrlCmd | KeyCode.KeyC,
		},
	},
	actionBar: {
		icon: 'codicon-copy',
		position: 'menu',
		category: 'Clipboard',
		order: 10
	},
	metadata: {
		description: localize('positronNotebook.cell.copyCells', "Copy Cell")
	}
});

// Cut cells command - Cmd/Ctrl+X
registerCellCommand({
	commandId: 'positronNotebook.cutCells',
	handler: (cell, notebook) => notebook.cutCells(),
	multiSelect: true,  // Cut all selected cells
	keybinding: {
		primary: KeyMod.CtrlCmd | KeyCode.KeyX,
	},
	actionBar: {
		position: 'menu',
		category: 'Clipboard',
		order: 20
	},
	metadata: {
		description: localize('positronNotebook.cell.cutCells', "Cut Cell")
	}
});

// Paste cells command - Cmd/Ctrl+V
registerCellCommand({
	commandId: 'positronNotebook.pasteCells',
	handler: (cell, notebook) => notebook.pasteCells(),
	keybinding: {
		primary: KeyMod.CtrlCmd | KeyCode.KeyV,
		win: { primary: KeyMod.CtrlCmd | KeyCode.KeyV, secondary: [KeyMod.Shift | KeyCode.Insert] },
		linux: { primary: KeyMod.CtrlCmd | KeyCode.KeyV, secondary: [KeyMod.Shift | KeyCode.Insert] },
	},
	actionBar: {
		position: 'menu',
		category: 'Clipboard',
		order: 40
	},
	metadata: {
		description: localize('positronNotebook.cell.pasteCells', "Paste Cell Below")
	}
});

// Paste cells above command - Cmd/Ctrl+Shift+V
registerCellCommand({
	commandId: 'positronNotebook.pasteCellsAbove',
	handler: (cell, notebook) => notebook.pasteCellsAbove(),
	keybinding: {
		primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyV,
	},
	actionBar: {
		position: 'menu',
		category: 'Clipboard',
		order: 30
	},
	metadata: {
		description: localize('positronNotebook.cell.pasteCellsAbove', "Paste Cell Above")
	}
});

// Move cell up
registerCellCommand({
	commandId: 'positronNotebook.cell.moveUp',
	handler: (cell, notebook) => notebook.moveCellUp(cell),
	multiSelect: true,  // Moves all selected cells
	editMode: true,     // Allow from editor focus
	when: CELL_CONTEXT_KEYS.canMoveUp,
	actionBar: {
		icon: 'codicon-arrow-up',
		position: 'menu',
		order: 110,
		category: 'Cell Order'
	},
	keybinding: {
		primary: KeyMod.Alt | KeyCode.UpArrow
	},
	metadata: {
		description: localize('positronNotebook.cell.moveUp', "Move cell up")
	}
});

// Move cell down
registerCellCommand({
	commandId: 'positronNotebook.cell.moveDown',
	handler: (cell, notebook) => notebook.moveCellDown(cell),
	multiSelect: true,  // Moves all selected cells
	editMode: true,     // Allow from editor focus
	when: CELL_CONTEXT_KEYS.canMoveDown,
	actionBar: {
		icon: 'codicon-arrow-down',
		position: 'menu',
		order: 111,
		category: 'Cell Order'
	},
	keybinding: {
		primary: KeyMod.Alt | KeyCode.DownArrow
	},
	metadata: {
		description: localize('positronNotebook.cell.moveDown', "Move cell down")
	}
});


//#endregion Cell Commands

//#region Notebook Header Actions
// Register notebook-level actions that appear in the editor action bar

// Run All Cells - Executes all code cells in the notebook
registerNotebookAction({
	commandId: 'positronNotebook.runAllCells',
	handler: (notebook) => notebook.runAllCells(),
	menu: {
		id: MenuId.EditorActionsLeft,
		group: 'navigation',
		order: 10,
		title: { value: localize('runAllCells', 'Run All'), original: 'Run All' },
		icon: ThemeIcon.fromId('notebook-execute-all'),
		positronActionBarOptions: {
			controlType: 'button',
			displayTitle: true
		}
	},
	keybinding: {
		primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter
	}
});

// Clear All Outputs - Clears outputs from all cells
registerNotebookAction({
	commandId: 'positronNotebook.clearAllOutputs',
	handler: (notebook) => notebook.clearAllCellOutputs(),
	menu: {
		id: MenuId.EditorActionsLeft,
		group: 'navigation',
		order: 20,
		title: { value: localize('clearAllOutputs', 'Clear Outputs'), original: 'Clear Outputs' },
		icon: ThemeIcon.fromId('positron-clean'),
		positronActionBarOptions: {
			controlType: 'button',
			displayTitle: true
		}
	},
	keybinding: {
		primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyK
	}
});

// Show Console - Opens or focuses the notebook console
registerNotebookAction({
	commandId: 'positronNotebook.showConsole',
	handler: (notebook) => notebook.showNotebookConsole(),
	menu: {
		id: MenuId.EditorActionsLeft,
		group: 'navigation',
		order: 30,
		title: { value: localize('showConsole', 'Show Console'), original: 'Show Console' },
		icon: ThemeIcon.fromId('terminal'),
		positronActionBarOptions: {
			controlType: 'button',
			displayTitle: true
		}
	}
});

// Add Code Cell at End - Inserts a new code cell at the end of the notebook
registerNotebookAction({
	commandId: 'positronNotebook.addCodeCellAtEnd',
	handler: (notebook) => {
		const cellCount = notebook.cells.get().length;
		notebook.addCell(CellKind.Code, cellCount);
	},
	menu: {
		id: MenuId.EditorActionsRight,
		group: 'navigation',
		order: 10,
		title: { value: localize('addCodeCell', 'Code'), original: 'Code' },
		icon: ThemeIcon.fromId('add'),
		positronActionBarOptions: {
			controlType: 'button',
			displayTitle: true
		}
	}
});

// Add Markdown Cell at End - Inserts a new markdown cell at the end of the notebook
registerNotebookAction({
	commandId: 'positronNotebook.addMarkdownCellAtEnd',
	handler: (notebook) => {
		const cellCount = notebook.cells.get().length;
		notebook.addCell(CellKind.Markup, cellCount);
	},
	menu: {
		id: MenuId.EditorActionsRight,
		group: 'navigation',
		order: 20,
		title: { value: localize('addMarkdownCell', 'Markdown'), original: 'Markdown' },
		icon: ThemeIcon.fromId('add'),
		positronActionBarOptions: {
			controlType: 'button',
			displayTitle: true
		}
	}
});

// Kernel Status Widget - Shows live kernel connection status at far right of action bar
// Widget is command-driven: clicking opens the kernel picker dropdown
registerNotebookAction({
	id: 'positronNotebook.kernelStatus',
	widget: {
		component: KernelStatusBadge,
		commandId: 'positronNotebook.selectKernel',
		commandArgs: { forceDropdown: true },
		ariaLabel: 'Select notebook kernel',
		tooltip: 'Click to select a kernel'
	},
	menu: {
		id: MenuId.EditorActionsRight,
		order: 100  // High order to appear after other actions
	}
});

//#endregion Notebook Header Actions

// Register actions
registerAction2(ExecuteSelectionInConsoleAction);
