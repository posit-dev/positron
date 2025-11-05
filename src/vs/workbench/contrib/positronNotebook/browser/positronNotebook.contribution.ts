/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
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
import { registerNotebookWidget } from './registerNotebookWidget.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { INotebookEditorOptions } from '../../notebook/browser/notebookBrowser.js';
import { POSITRON_EXECUTE_CELL_COMMAND_ID, POSITRON_NOTEBOOK_EDITOR_ID, POSITRON_NOTEBOOK_EDITOR_INPUT_ID } from '../common/positronNotebookCommon.js';
import { getEditingCell, getSelectedCell, getSelectedCells, SelectionState } from './selectionMachine.js';
import { POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS as CELL_CONTEXT_KEYS, POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED, POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED } from './ContextKeysManager.js';
import './contrib/undoRedo/positronNotebookUndoRedo.js';
import { registerAction2, MenuId, Action2, IAction2Options, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ExecuteSelectionInConsoleAction } from './ExecuteSelectionInConsoleAction.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { KernelStatusBadge } from './KernelStatusBadge.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { UpdateNotebookWorkingDirectoryAction } from './UpdateNotebookWorkingDirectoryAction.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromActiveEditorPane } from './notebookUtils.js';
import { ActiveNotebookHasRunningRuntime } from '../../runtimeNotebookKernel/common/activeRuntimeNotebookContextManager.js';
import { IPositronNotebookCell } from './PositronNotebookCells/IPositronNotebookCell.js';

const POSITRON_NOTEBOOK_CATEGORY = localize2('positronNotebook.category', 'Notebook');

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

/**
 * Base class for notebook-level actions that operate on IPositronNotebookInstance.
 * Automatically gets the active notebook instance and passes it to the _run method.
 */
abstract class NotebookAction2 extends Action2 {
	override run(accessor: ServicesAccessor, ...args: any[]): void {
		const editorService = accessor.get(IEditorService);
		const activeNotebook = getNotebookInstanceFromActiveEditorPane(editorService);
		if (!activeNotebook) {
			return;
		}
		this.runNotebookAction(activeNotebook, accessor);
	}

	protected abstract runNotebookAction(notebook: IPositronNotebookInstance, accessor: ServicesAccessor): any;
}

//#region Notebook Commands
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.selectUp',
			title: localize2('positronNotebook.selectUp', "Move focus up"),
			keybinding: {
				when: POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.UpArrow,
				secondary: [KeyCode.KeyK]
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.selectionStateMachine.moveSelectionUp(false);
	}
});

registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.selectDown',
			title: localize2('positronNotebook.selectDown', "Move focus down"),
			keybinding: {
				when: POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.DownArrow,
				secondary: [KeyCode.KeyJ]
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.selectionStateMachine.moveSelectionDown(false);
	}
});

registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.addSelectionDown',
			title: localize2('positronNotebook.addSelectionDown', "Extend selection down"),
			keybinding: {
				when: POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Shift | KeyCode.DownArrow,
				secondary: [KeyMod.Shift | KeyCode.KeyJ]
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.selectionStateMachine.moveSelectionDown(true);
	}
});

registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.addSelectionUp',
			title: localize2('positronNotebook.addSelectionUp', "Extend selection up"),
			keybinding: {
				when: POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Shift | KeyCode.UpArrow,
				secondary: [KeyMod.Shift | KeyCode.KeyK]
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.selectionStateMachine.moveSelectionUp(true);
	}
});

// Enter key: Enter edit mode when cell is selected but NOT editing
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.edit',
			title: localize2('positronNotebook.cell.edit', "Enter cell edit mode"),
			keybinding: {
				when: ContextKeyExpr.and(
					POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
					POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED.toNegated()
				),
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Enter
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.selectionStateMachine.enterEditor().catch(err => {
			console.error('Error entering editor:', err);
		});
	}
});

/**
 * Escape key: Exit edit mode when cell editor is focused.
 * This command handles the keybinding for all cell types.
 *
 * This action has a counterpart command called
 * `positronNotebook.cell.collapseMarkdownEditor` that is
 * used to contribute the same functionality to markdown
 * cell action bars. We should keep both commands in sync
 * to ensure consistent behavior.
 */
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.quitEdit',
			title: localize2('positronNotebook.cell.quitEdit', "Exit cell edit mode"),
			keybinding: {
				when: POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Escape
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		// check if we are in editing mode
		if (state.type === SelectionState.EditingSelection) {
			// get the selected cell that is being edited
			const cell = state.selected;
			// handle markdown cells differently
			if (cell.isMarkdownCell() && cell.editorShown.get()) {
				// This handles updating selection state and closing the editor
				cell.toggleEditor();
			} else {
				notebook.selectionStateMachine.exitEditor();
			}
		}
	}
});

// Z key: Undo in command mode (Jupyter-style)
// Adds keybinding to existing 'undo' command that's handled by contrib/undoRedo/positronNotebookUndoRedo.ts
KeybindingsRegistry.registerKeybindingRule({
	id: 'undo',
	weight: KeybindingWeight.EditorContrib,
	when: ContextKeyExpr.and(
		POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
		POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED.toNegated()
	),
	primary: KeyCode.KeyZ
});

// Shift+Z key: Redo in command mode (Jupyter-style)
// Adds keybinding to existing 'redo' command that's handled by contrib/undoRedo/positronNotebookUndoRedo.ts
KeybindingsRegistry.registerKeybindingRule({
	id: 'redo',
	weight: KeybindingWeight.EditorContrib,
	when: ContextKeyExpr.and(
		POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
		POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED.toNegated()
	),
	primary: KeyMod.Shift | KeyCode.KeyZ
});

//#endregion Notebook Commands

//#region Cell Commands
// Register delete command with UI in one call
// For built-in commands, we don't need to manage the disposable since they live
// for the lifetime of the application

interface ICellActionOptions {
	readonly multiSelect?: boolean;
	readonly editMode?: boolean;
}

function isCellActionBarAction(action: Action2) {
	const menu = action.desc.menu;
	if (!menu) {
		return false;
	}
	const menus = Array.isArray(menu) ? menu : [menu];
	return menus.some(({ id }) =>
		id === MenuId.PositronNotebookCellActionBarLeft ||
		id === MenuId.PositronNotebookCellActionBarRight ||
		id === MenuId.PositronNotebookCellActionBarSubmenu);
}

abstract class CellAction2 extends Action2 {
	constructor(
		desc: Readonly<IAction2Options>,
		readonly options?: ICellActionOptions,
	) {
		super(desc);
	}

	override run(accessor: ServicesAccessor, ...args: any[]): void {
		const editorService = accessor.get(IEditorService);
		const activeNotebook = getNotebookInstanceFromActiveEditorPane(editorService);
		if (!activeNotebook) {
			return;
		}

		if (this.options?.multiSelect) {
			// Handle multiple selected cells
			const selectedCells = getSelectedCells(activeNotebook.selectionStateMachine.state.get());

			for (const cell of selectedCells) {
				this.runCellAction(cell, activeNotebook, accessor);
			}
		} else {
			// Handle single cell
			const state = activeNotebook.selectionStateMachine.state.get();
			// Always check editing cell if actionBar is present (action bar items should work in edit mode).
			// Otherwise, only check editing cell if editMode option is enabled.
			const cell = getSelectedCell(state) || ((isCellActionBarAction(this) || this.options?.editMode) ? getEditingCell(state) : undefined);
			if (cell) {
				this.runCellAction(cell, activeNotebook, accessor);
			}
		}
	}

	abstract runCellAction(cell: IPositronNotebookCell, notebook: IPositronNotebookInstance, accessor: ServicesAccessor): any;
}

registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.insertCodeCellAboveAndFocusContainer',
			title: localize2('positronNotebook.codeCell.insertAbove', "Insert Code Cell Above"),
			icon: ThemeIcon.fromId('arrow-up'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				order: 100,
				group: 'Cell'
			}, {
				id: MenuId.PositronNotebookCellInsert,
				order: 10
			}],
			keybinding: {
				when: POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.KeyA
			}
		});
	}

	override runCellAction(cell: IPositronNotebookCell, _notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		cell.insertCodeCellAbove();
	}
});

registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.insertCodeCellBelowAndFocusContainer',
			title: localize2('positronNotebook.codeCell.insertBelow', "Insert Code Cell Below"),
			icon: ThemeIcon.fromId('arrow-down'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				order: 100,
				group: 'Cell'
			}, {
				id: MenuId.PositronNotebookCellInsert,
				order: 20
			}],
			keybinding: {
				when: POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.KeyB
			}
		});
	}

	override runCellAction(cell: IPositronNotebookCell, _notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		cell.insertCodeCellBelow();
	}
});

registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.insertMarkdownCellAboveAndFocusContainer',
			title: localize2('positronNotebook.markdownCell.insertAbove', "Insert Markdown Cell Above"),
			icon: ThemeIcon.fromId('arrow-up'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				order: 100,
				group: 'Cell'
			}, {
				id: MenuId.PositronNotebookCellInsert,
				order: 30
			}]
		});
	}

	override runCellAction(cell: IPositronNotebookCell, _notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		cell.insertMarkdownCellAbove();
	}
});

registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.insertMarkdownCellBelowAndFocusContainer',
			title: localize2('positronNotebook.markdownCell.insertBelow', "Insert Markdown Cell Below"),
			icon: ThemeIcon.fromId('arrow-down'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				order: 100,
				group: 'Cell'
			}, {
				id: MenuId.PositronNotebookCellInsert,
				order: 40
			}]
		});
	}

	override runCellAction(cell: IPositronNotebookCell, _notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		cell.insertMarkdownCellBelow();
	}
});

registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.delete',
			title: localize2('positronNotebook.cell.delete.description', "Delete the selected cell(s)"),
			icon: ThemeIcon.fromId('trash'),
			menu: {
				id: MenuId.PositronNotebookCellActionBarRight,
				order: 100,
				group: 'Cell'
			},
			keybinding: {
				when: POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Backspace,
				secondary: [KeyChord(KeyCode.KeyD, KeyCode.KeyD)]
			}
		}, { multiSelect: true, editMode: false });
	}

	override runCellAction(cell: IPositronNotebookCell, _notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		cell.delete();
	}
});

// Make sure the run and stop commands are in the same place so they replace one another.
const CELL_EXECUTION_POSITION = 10;
registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: POSITRON_EXECUTE_CELL_COMMAND_ID,
			title: localize2('positronNotebook.cell.execute', "Execute cell"),
			icon: ThemeIcon.fromId('play'),
			menu: {
				id: MenuId.PositronNotebookCellActionLeft,
				order: CELL_EXECUTION_POSITION,
				group: 'Execution',
				when: ContextKeyExpr.and(
					CELL_CONTEXT_KEYS.isCode.isEqualTo(true),
					CELL_CONTEXT_KEYS.isRunning.toNegated(),
					CELL_CONTEXT_KEYS.isPending.toNegated()
				)
			}
		});
	}

	override runCellAction(cell: IPositronNotebookCell, _notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		cell.run();
	}
});

registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.stopExecution',
			title: localize2('positronNotebook.cell.stopExecution', "Stop cell execution"),
			icon: ThemeIcon.fromId('primitive-square'),
			menu: {
				id: MenuId.PositronNotebookCellActionLeft,
				order: CELL_EXECUTION_POSITION,
				group: 'Execution',
				when: ContextKeyExpr.and(
					CELL_CONTEXT_KEYS.isCode.isEqualTo(true),
					ContextKeyExpr.or(
						CELL_CONTEXT_KEYS.isRunning.isEqualTo(true),
						CELL_CONTEXT_KEYS.isPending.isEqualTo(true)
					)
				)
			}
		});
	}

	override runCellAction(cell: IPositronNotebookCell, _notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		cell.run(); // Run called when cell is executing is stop
	}
});

registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.debug',
			title: localize2('positronNotebook.cell.debug', "Debug cell"),
			icon: ThemeIcon.fromId('debug-alt-small'),
			menu: {
				id: MenuId.PositronNotebookCellActionBarLeft,
				order: 10,
				group: 'Execution',
				when: CELL_CONTEXT_KEYS.isCode
			},
			keybinding: {
				when: ContextKeyExpr.or(
					POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
					POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED
				),
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Alt | KeyMod.Shift | KeyCode.Enter
			}
		}, { multiSelect: false, editMode: true });
	}

	override async runCellAction(cell: IPositronNotebookCell, notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
		await accessor.get(ICommandService).executeCommand('notebook.debugCell', {
			// Args expected by the notebook.debugCell command,
			// a subset of vscode.NotebookCell
			notebook: {
				uri: notebook.uri,
			},
			document: {
				uri: cell.uri,
			},
		});
	}
});

// Run all code cells above the current cell
registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.runAllAbove',
			title: localize2('positronNotebook.cell.runAllAbove', "Execute Above Cells"),
			icon: ThemeIcon.fromId('run-above'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarLeft,
				order: 20,
				group: 'Execution',
				when: ContextKeyExpr.and(
					CELL_CONTEXT_KEYS.isCode.isEqualTo(true),
					CELL_CONTEXT_KEYS.isFirst.toNegated()
				)
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: '3_execution',
				order: 10
			}]
		});
	}

	override runCellAction(cell: IPositronNotebookCell, notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const cells = notebook.cells.get();

		// Run all code cells above the current cell
		const cellIndex = cell.index;
		for (let i = 0; i < cellIndex; i++) {
			const targetCell = cells[i];
			if (targetCell.isCodeCell()) {
				targetCell.run();
			}
		}
	}
});

// Run all code cells below the current cell
registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.runAllBelow',
			title: localize2('positronNotebook.cell.runAllBelow', "Execute Cell and Below"),
			icon: ThemeIcon.fromId('run-below'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarLeft,
				order: 21,
				group: 'Execution',
				when: ContextKeyExpr.and(
					CELL_CONTEXT_KEYS.isCode.isEqualTo(true),
					CELL_CONTEXT_KEYS.isLast.toNegated()
				)
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: '3_execution',
				order: 20
			}]
		});
	}

	override runCellAction(cell: IPositronNotebookCell, notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const cells = notebook.cells.get();

		// Run all code cells below the current cell
		for (let i = cell.index + 1; i < cells.length; i++) {
			const targetCell = cells[i];
			if (targetCell.isCodeCell()) {
				targetCell.run();
			}
		}
	}
});

// Open markdown editor (For action bar)
registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.openMarkdownEditor',
			title: localize2('positronNotebook.cell.openMarkdownEditor', "Open markdown editor"),
			icon: ThemeIcon.fromId('chevron-down'),
			menu: {
				id: MenuId.PositronNotebookCellActionBarLeft,
				order: 10,
				group: 'Markdown',
				when: ContextKeyExpr.and(
					CELL_CONTEXT_KEYS.isMarkdown.isEqualTo(true),
					CELL_CONTEXT_KEYS.markdownEditorOpen.toNegated()
				)
			}
		});
	}

	override runCellAction(cell: IPositronNotebookCell, _notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		if (cell.isMarkdownCell()) {
			// This test is just to appease typescript, we know it's a markdown cell
			cell.toggleEditor();
		}
	}
});

/**
 * Collapse markdown editor (For action bar)
 *
 * Handles contributing the behavior of
 * `positronNotebook.cell.quitEdit` to markdown cell
 * action bar. We should keep both commands in sync to
 * ensure consistent behavior.
 */
registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.collapseMarkdownEditor',
			title: localize2('positronNotebook.cell.collapseMarkdownEditor', "Collapse markdown editor"),
			icon: ThemeIcon.fromId('chevron-up'),
			menu: {
				id: MenuId.PositronNotebookCellActionBarLeft,
				order: 10,
				group: 'Markdown',
				when: ContextKeyExpr.and(
					CELL_CONTEXT_KEYS.isMarkdown.isEqualTo(true),
					CELL_CONTEXT_KEYS.markdownEditorOpen.isEqualTo(true)
				)
			}
		});
	}

	override runCellAction(cell: IPositronNotebookCell, _notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		if (cell.isMarkdownCell()) {
			// This test is just to appease typescript, we know it's a markdown cell
			cell.toggleEditor();
		}
	}
});


// Keyboard shortcut commands. These are not shown in the action bar.
// TODO: Improve the context key support so we don't need to have a single command per
// the keyboard shortcut and can reuse the action bar commands. Cell agnostic
// "Execute in place" command.
registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.executeOrToggleEditor',
			title: localize2('positronNotebook.cell.executeOrToggleEditor', "Execute cell or toggle editor"),
			keybinding: {
				when: ContextKeyExpr.or(
					POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
					POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED
				),
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.CtrlCmd | KeyCode.Enter
			}
		}, { multiSelect: false, editMode: true });
	}

	override runCellAction(cell: IPositronNotebookCell, _notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		if (cell.isMarkdownCell()) {
			cell.toggleEditor();
		} else {
			// This also stops if the cell is running.
			cell.run();
		}
	}
});


// Execute cell and select below
registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.executeAndSelectBelow',
			title: localize2('positronNotebook.cell.executeAndSelectBelow', "Execute cell and select below"),
			keybinding: {
				when: ContextKeyExpr.or(
					POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
					POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED
				),
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Shift | KeyCode.Enter
			}
		}, { multiSelect: false, editMode: true });
	}

	override runCellAction(cell: IPositronNotebookCell, notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
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
			notebook.addCell(cell.kind, cell.index + 1, true);
			// Don't call moveDown - addCell triggers SelectionStateMachine._setCells()
			// which already handles selection and focus of the new cell in Edit mode
		} else {
			// Only move down if we didn't add a cell
			notebook.selectionStateMachine.moveSelectionDown(false);
		}
	}
});

// Copy cells command - C (Jupyter-style)
registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.copyCells',
			title: localize2('positronNotebook.cell.copyCells', "Copy Cell"),
			icon: ThemeIcon.fromId('copy'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: 'Clipboard',
				order: 20
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: '1_clipboard',
				order: 20
			}],
			keybinding: {
				when: POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.KeyC
			}
		}, { multiSelect: true });
	}

	override runCellAction(_cell: IPositronNotebookCell, notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.copyCells();
	}
});

// Cut cells command - X (Jupyter-style)
registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cutCells',
			title: localize2('positronNotebook.cell.cutCells', "Cut Cell"),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: 'Clipboard',
				order: 10
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: '1_clipboard',
				order: 10
			}],
			keybinding: {
				when: POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.KeyX
			}
		}, { multiSelect: true });
	}

	override runCellAction(_cell: IPositronNotebookCell, notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.cutCells();
	}
});

// Paste cells command - V (Jupyter-style)
registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.pasteCells',
			title: localize2('positronNotebook.cell.pasteCells', "Paste Cell Below"),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: 'Clipboard',
				order: 40
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: '1_clipboard',
				order: 40
			}],
			keybinding: {
				when: POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.KeyV
			}
		});
	}

	override runCellAction(_cell: IPositronNotebookCell, notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.pasteCells();
	}
});

// Paste cells above command - Shift+V (Jupyter-style)
registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.pasteCellsAbove',
			title: localize2('positronNotebook.cell.pasteCellsAbove', "Paste Cell Above"),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: 'Clipboard',
				order: 30
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: '1_clipboard',
				order: 30
			}],
			keybinding: {
				when: POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Shift | KeyCode.KeyV
			}
		});
	}

	override runCellAction(_cell: IPositronNotebookCell, notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.pasteCellsAbove();
	}
});

// Move cell up
registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.moveUp',
			title: localize2('positronNotebook.cell.moveUp', "Move cell up"),
			icon: ThemeIcon.fromId('arrow-up'),
			menu: {
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				order: 110,
				group: 'Cell Order',
				when: CELL_CONTEXT_KEYS.canMoveUp
			},
			keybinding: {
				when: ContextKeyExpr.or(
					POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
					POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED
				),
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Alt | KeyCode.UpArrow
			}
		}, { multiSelect: true, editMode: true });
	}

	override runCellAction(cell: IPositronNotebookCell, notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.moveCellUp(cell);
	}
});

// Move cell down
registerAction2(class extends CellAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.moveDown',
			title: localize2('positronNotebook.cell.moveDown', "Move cell down"),
			icon: ThemeIcon.fromId('arrow-down'),
			menu: {
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				order: 111,
				group: 'Cell Order',
				when: CELL_CONTEXT_KEYS.canMoveDown
			},
			keybinding: {
				when: ContextKeyExpr.or(
					POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
					POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED
				),
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Alt | KeyCode.DownArrow
			}
		}, { multiSelect: true, editMode: true });
	}

	override runCellAction(cell: IPositronNotebookCell, notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.moveCellDown(cell);
	}
});


//#endregion Cell Commands

//#region Notebook Header Actions
// Register notebook-level actions that appear in the editor action bar

// Run All Cells - Executes all code cells in the notebook
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.runAllCells',
			title: localize2('runAllCells', 'Run All'),
			icon: ThemeIcon.fromId('notebook-execute-all'),
			f1: true,
			category: POSITRON_NOTEBOOK_CATEGORY,
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: false
			},
			menu: {
				id: MenuId.EditorActionsLeft,
				group: 'navigation',
				order: 10,
				when: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID)
			},
			keybinding: {
				when: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.runAllCells();
	}
});

// Clear All Outputs - Clears outputs from all cells
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.clearAllOutputs',
			title: localize2('clearAllOutputs', 'Clear Outputs'),
			icon: ThemeIcon.fromId('positron-clean'),
			f1: true,
			category: POSITRON_NOTEBOOK_CATEGORY,
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: false
			},
			menu: {
				id: MenuId.EditorActionsLeft,
				group: 'navigation',
				order: 20,
				when: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID)
			},
			keybinding: {
				when: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
				weight: KeybindingWeight.EditorContrib,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyK)
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.clearAllCellOutputs();
	}
});

// Show Console - Opens or focuses the notebook console
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.showConsole',
			title: localize2('showConsole', 'Open Notebook Console'),
			icon: ThemeIcon.fromId('terminal'),
			f1: true,
			category: POSITRON_NOTEBOOK_CATEGORY,
			precondition: ActiveNotebookHasRunningRuntime,
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: true
			},
			menu: {
				id: MenuId.PositronNotebookKernelSubmenu,
				order: 100,
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.showNotebookConsole();
	}
});

// Add Code Cell at End - Inserts a new code cell at the end of the notebook
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.addCodeCellAtEnd',
			title: localize2('addCodeCell', 'Code'),
			icon: ThemeIcon.fromId('add'),
			f1: true,
			category: POSITRON_NOTEBOOK_CATEGORY,
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: true
			},
			menu: {
				id: MenuId.EditorActionsLeft,
				group: 'navigation',
				order: 30,
				when: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID)
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const cellCount = notebook.cells.get().length;
		notebook.addCell(CellKind.Code, cellCount, true);
	}
});

// Add Markdown Cell at End - Inserts a new markdown cell at the end of the notebook
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.addMarkdownCellAtEnd',
			title: localize2('addMarkdownCell', 'Markdown'),
			icon: ThemeIcon.fromId('add'),
			f1: true,
			category: POSITRON_NOTEBOOK_CATEGORY,
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: true
			},
			menu: {
				id: MenuId.EditorActionsLeft,
				group: 'navigation',
				order: 40,
				when: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID)
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const cellCount = notebook.cells.get().length;
		notebook.addCell(CellKind.Markup, cellCount, true);
	}
});

// Kernel Status Widget - Shows live kernel connection status at far right of action bar
// Widget is self-contained: manages its own menu interactions via ActionBarMenuButton
registerNotebookWidget({
	id: 'positronNotebook.kernelStatus',
	widget: {
		component: KernelStatusBadge,
		selfContained: true
	},
	menu: {
		id: MenuId.EditorActionsRight,
		order: 100  // High order to appear after other actions
	}
});

//#endregion Notebook Header Actions

// Register actions
registerAction2(ExecuteSelectionInConsoleAction);
registerAction2(UpdateNotebookWorkingDirectoryAction);

// Add the Notebook Cell submenu to the editor context menu (right click in cell editor)
MenuRegistry.appendMenuItem(MenuId.EditorContext, {
	submenu: MenuId.PositronNotebookCellContext,
	title: localize('positronNotebook.menu.editorContext.cell', 'Notebook Cell'),
	group: '2_notebook',
	when: POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED,
	order: 0
});

// Add the Insert Cell submenu to the Notebook Cell menu
MenuRegistry.appendMenuItem(MenuId.PositronNotebookCellContext, {
	submenu: MenuId.PositronNotebookCellInsert,
	title: localize('positronNotebook.menu.cellContext.insert', 'Insert Cell'),
	group: '2_insert',
	order: 0
});
