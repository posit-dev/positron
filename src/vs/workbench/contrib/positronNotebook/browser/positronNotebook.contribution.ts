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

import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { checkPositronNotebookEnabled } from './positronNotebookExperimentalConfig.js';
import { IWorkingCopyEditorHandler, IWorkingCopyEditorService } from '../../../services/workingCopy/common/workingCopyEditorService.js';
import { IWorkingCopyIdentifier } from '../../../services/workingCopy/common/workingCopy.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { isEqual } from '../../../../base/common/resources.js';
import { CellUri, NotebookWorkingCopyTypeIdentifier } from '../../notebook/common/notebookCommon.js';
import { registerCellCommand } from './notebookCells/actionBar/registerCellCommand.js';
import { registerNotebookCommand } from './notebookCells/actionBar/registerNotebookCommand.js';
import { CellConditions } from './notebookCells/actionBar/cellConditions.js';
import { INotebookEditorOptions } from '../../notebook/browser/notebookBrowser.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';


/**
 * PositronNotebookContribution class.
 */
class PositronNotebookContribution extends Disposable {
	static readonly ID = 'workbench.contrib.positronNotebookContribution';

	constructor(
		@IEditorResolverService private readonly editorResolverService: IEditorResolverService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService
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
					// Support both file:// and untitled:// schemes
					return resource.scheme === Schemas.file || resource.scheme === Schemas.untitled;
				}
			},
			{
				createEditorInput: async ({ resource, options }) => {
					const notebookEditorInput = PositronNotebookEditorInput.getOrCreate(
						this.instantiationService,
						resource,
						undefined,
					);
					return { editor: notebookEditorInput, options };
				}
			},
		));

		// Register for cells in .ipynb files
		this._register(this.editorResolverService.registerEditor(
			`${Schemas.vscodeNotebookCell}:/**/*.ipynb`,
			// We have to use exclusive priority because vscode.window.showTextDocument(cell.document)
			// restricts to editors with exclusive priority.
			// This does not seem to be an issue for file schemes (registered above).
			{ ...notebookEditorInfo, priority: RegisteredEditorPriority.exclusive },
			{
				singlePerResource: true,
				canSupportResource: (resource: URI) => {
					return resource.scheme === Schemas.vscodeNotebookCell;
				}
			},
			{
				createEditorInput: async (editorInput) => {
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
	PositronNotebookEditorInput.ID,
	PositronNotebookEditorSerializer
);


//#region Notebook Commands
registerNotebookCommand({
	commandId: 'positronNotebook.focusUp',
	handler: (notebook) => notebook.selectionStateMachine.moveUp(false),
	keybinding: {
		primary: KeyCode.UpArrow,
		secondary: [KeyCode.KeyK]
	},
	metadata: {
		description: localize('positronNotebook.focusUp', "Move focus up")
	}
});

registerNotebookCommand({
	commandId: 'positronNotebook.focusDown',
	handler: (notebook) => notebook.selectionStateMachine.moveDown(false),
	keybinding: {
		primary: KeyCode.DownArrow,
		secondary: [KeyCode.KeyJ]
	},
	metadata: {
		description: localize('positronNotebook.focusDown', "Move focus down")
	}
});

registerNotebookCommand({
	commandId: 'positronNotebook.addSelectionDown',
	handler: (notebook) => notebook.selectionStateMachine.moveDown(true),
	keybinding: {
		primary: KeyMod.Shift | KeyCode.DownArrow,
		secondary: [KeyMod.Shift | KeyCode.KeyJ]
	},
	metadata: {
		description: localize('positronNotebook.addSelectionDown', "Extend selection down")
	}
});

registerNotebookCommand({
	commandId: 'positronNotebook.addSelectionUp',
	handler: (notebook) => notebook.selectionStateMachine.moveUp(true),
	keybinding: {
		primary: KeyMod.Shift | KeyCode.UpArrow,
		secondary: [KeyMod.Shift | KeyCode.KeyK]
	},
	metadata: {
		description: localize('positronNotebook.addSelectionUp', "Extend selection up")
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

registerCellCommand(
	{
		commandId: 'positronNotebook.cell.delete',
		handler: (cell) => cell.delete(),
		multiSelect: true,  // Delete all selected cells
		actionBar: {
			icon: 'codicon-trash',
			position: 'main',
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
	handler: (cell) => cell.run(),
	cellCondition: CellConditions.and(
		CellConditions.isCode,
		CellConditions.not(CellConditions.isRunning)
	),  // Only show on code cells that are not running
	keybinding: {
		primary: KeyMod.CtrlCmd | KeyCode.Enter
	},
	actionBar: {
		icon: 'codicon-play',
		position: 'left',
		order: CELL_EXECUTION_POSITION,
		category: 'Execution'
	},
	metadata: {
		description: localize('positronNotebook.cell.execute', "Execute cell")
	}
});

registerCellCommand({
	commandId: 'positronNotebook.cell.stopExecution',
	handler: (cell) => cell.run(), // Run called when cell is executing is stop
	cellCondition: CellConditions.and(
		CellConditions.isCode,
		CellConditions.isRunning
	),  // Only show on code cells that are running
	keybinding: {
		primary: KeyMod.CtrlCmd | KeyCode.Enter
	},
	actionBar: {
		icon: 'codicon-primitive-square',
		position: 'left',
		order: CELL_EXECUTION_POSITION,
		category: 'Execution'
	},
	metadata: {
		description: localize('positronNotebook.cell.stopExecution', "Stop cell execution")
	}
});

registerCellCommand({
	commandId: 'positronNotebook.cell.executeAndSelectBelow',
	handler: (cell, notebook) => {
		cell.run();
		notebook.selectionStateMachine.moveDown(false);
	},
	cellCondition: CellConditions.isCode,  // Only show on code cells
	keybinding: {
		primary: KeyMod.Shift | KeyCode.Enter
	},
	metadata: {
		description: localize('positronNotebook.cell.executeAndSelectBelow', "Execute cell and select below")
	}
});

// Example of position-based conditions
registerCellCommand({
	commandId: 'positronNotebook.cell.runAllAbove',
	handler: (cell, notebook) => {
		const cells = notebook.cells.get();
		const cellIndex = cells.indexOf(cell);

		// Run all code cells above the current cell
		for (let i = 0; i < cellIndex; i++) {
			const targetCell = cells[i];
			if (targetCell.isCodeCell()) {
				targetCell.run();
			}
		}
	},
	cellCondition: CellConditions.and(
		CellConditions.isCode,     // Only on code cells
		CellConditions.notFirst    // Not on the first cell
	),
	actionBar: {
		icon: 'codicon-run-above',
		position: 'menu',
		order: 20,
		category: 'Execution'
	},
	metadata: {
		description: localize('positronNotebook.cell.runAllAbove', "Run all code cells above this cell")
	}
});

registerCellCommand({
	commandId: 'positronNotebook.cell.runAllBelow',
	handler: (cell, notebook) => {
		if (!notebook) { return; }

		const cells = notebook.cells.get();
		const cellIndex = cells.indexOf(cell);

		// Run all code cells below the current cell
		for (let i = cellIndex + 1; i < cells.length; i++) {
			const targetCell = cells[i];
			if (targetCell.isCodeCell()) {
				targetCell.run();
			}
		}
	},
	cellCondition: CellConditions.and(
		CellConditions.isCode,     // Only on code cells
		CellConditions.notLast     // Not on the last cell
	),
	actionBar: {
		icon: 'codicon-run-below',
		position: 'menu',
		order: 21,
		category: 'Execution'
	},
	metadata: {
		description: localize('positronNotebook.cell.runAllBelow', "Run all code cells below this cell")
	}
});

// Markdown cell toggle editor command
registerCellCommand({
	commandId: 'positronNotebook.cell.toggleMarkdownEditor',
	handler: (cell) => {
		if (cell.isMarkdownCell()) {
			cell.toggleEditor();
		}
	},
	cellCondition: CellConditions.isMarkdown,  // Only on markdown cells
	actionBar: {
		icon: 'codicon-primitive-square',  // Will need to be dynamic based on editor state
		position: 'main',
		order: 10,
		category: 'Markdown'
	},
	metadata: {
		description: localize('positronNotebook.cell.toggleMarkdownEditor', "Toggle markdown editor visibility")
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


//#endregion Cell Commands


