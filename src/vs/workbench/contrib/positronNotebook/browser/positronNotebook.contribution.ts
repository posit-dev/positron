/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Notebook editor extensions
import './contrib/find/positronNotebookFind.contribution.js';
import './contrib/assistant/positronNotebookAssistant.contribution.js';
import './contrib/ghostCell/positronNotebookGhostCell.contribution.js';
import './contrib/outline/positronNotebookOutline.contribution.js';
import './contrib/help/NotebookHelpAction.js';
import './contrib/commands/NotebookCommandsAction.js';

// Self-registering Action2 contributions
import './notebookCells/InlineDataExplorerActions.js';
import './SelectPositronNotebookKernelAction.js';
import './contrib/visualize/VisualizeAction.js';
import './contrib/cellTags/actions.js';
import './AssistantPanel/notebookSuggestionsConfig.js';

import { copyImageToClipboard, isCopyImageMenuArg } from './copyImageUtils.js';
import { isCopyJsonMenuArg, serializeJsonOutput } from './copyJsonUtils.js';
import { getPlainTextOutputContent, isParsedTextOutput } from './getOutputContents.js';
import { getActiveWindow, isEditableElement, isHTMLElement } from '../../../../base/browser/dom.js';
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
import { POSITRON_NOTEBOOK_ENABLED_KEY } from '../common/positronNotebookConfig.js';
import { IWorkingCopyEditorHandler, IWorkingCopyEditorService } from '../../../services/workingCopy/common/workingCopyEditorService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkingCopyIdentifier } from '../../../services/workingCopy/common/workingCopy.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { extname, isEqual } from '../../../../base/common/resources.js';
import { CellKind, CellUri, NotebookWorkingCopyTypeIdentifier } from '../../notebook/common/notebookCommon.js';
import { registerNotebookWidget } from './registerNotebookWidget.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { bindContextKey } from '../../../../platform/observable/common/platformObservableUtils.js';
import { IPositronNotebookService } from './positronNotebookService.js';
import { IPYNB_VIEW_TYPE } from '../../notebook/browser/notebookBrowser.js';
import { IPositronNotebookEditorOptions } from './positronNotebookEditorTypes.js';
import { POSITRON_EXECUTE_CELL_COMMAND_ID, POSITRON_NOTEBOOK_CATEGORY, POSITRON_NOTEBOOK_EDITOR_ID, POSITRON_NOTEBOOK_EDITOR_INPUT_ID, PositronNotebookActionId, PositronNotebookCellActionBarLeftGroup, PositronNotebookCellActionGroup, PositronNotebookCellOutputActionGroup, usingPositronNotebooks } from '../common/positronNotebookCommon.js';
import { getActiveCell, getSelectedCells, SelectionState } from './selectionMachine.js';
import { CellContextKeys } from '../common/cellContextKeys.js';
import { NotebookContextKeys } from '../common/notebookContextKeys.js';
import './contrib/undoRedo/positronNotebookUndoRedo.js';
import { Action2, registerAction2, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ExecuteSelectionInCellAction } from './ExecuteSelectionInCellAction.js';
import { ExecuteSelectionInConsoleAction } from './ExecuteSelectionInConsoleAction.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { KernelStatusBadge } from './KernelStatusBadge.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { UpdateNotebookWorkingDirectoryAction } from './UpdateNotebookWorkingDirectoryAction.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { IPositronNotebookCell } from './PositronNotebookCells/IPositronNotebookCell.js';
import { PositronNotebookPromptContribution } from './positronNotebookPrompt.js';
import { ActiveNotebookHasRunningRuntime } from '../../runtimeNotebookKernel/common/activeRuntimeNotebookContextManager.js';
import { NOTEBOOK_HAS_SOMETHING_RUNNING } from '../../notebook/common/notebookContextKeys.js';
import { NotebookAction2 } from './NotebookAction2.js';
import './AskAssistantAction.js'; // Register AskAssistantAction
import { CONTEXT_FIND_INPUT_FOCUSED, CONTEXT_REPLACE_INPUT_FOCUSED } from '../../../../editor/contrib/find/browser/findModel.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IOutlinePane } from '../../outline/browser/outline.js';

export const POSITRON_NOTEBOOK_COMMAND_MODE = ContextKeyExpr.and(
	NotebookContextKeys.editorFocused,
	NotebookContextKeys.cellEditorFocused.toNegated(),
	CONTEXT_FIND_INPUT_FOCUSED.toNegated(),
	CONTEXT_REPLACE_INPUT_FOCUSED.toNegated(),
);

/**
 * Infer the notebook view type from a resource's file extension.
 */
function inferViewTypeFromExtension(resource: URI): string | undefined {
	if (extname(resource) === '.ipynb') {
		return IPYNB_VIEW_TYPE;
	}
	return undefined;
}

/**
 * Configuration for registering a notebook editor with the editor resolver service.
 */
interface NotebookEditorRegistration {
	detail: string;
	extension: string;
	globPattern: string;
	viewType: string;
}

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
		@INotebookService private readonly notebookService: INotebookService,
		@IPositronNotebookService positronNotebookService: IPositronNotebookService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		this._register(bindContextKey(
			NotebookContextKeys.experimental,
			contextKeyService,
			reader => positronNotebookService.experimentsEnabled.read(reader),
		));

		this.registerEditor();
	}

	private registerEditor(): void {
		this.registerNotebookEditor({
			detail: localize('positronNotebook.ipynb.detail', 'Native .ipynb Support'),
			extension: '.ipynb',
			globPattern: '*.ipynb',
			viewType: IPYNB_VIEW_TYPE,
		});
	}

	private getPriority(): RegisteredEditorPriority {
		return usingPositronNotebooks(this.configurationService)
			? RegisteredEditorPriority.default
			: RegisteredEditorPriority.option;
	}

	private getCellPriority(): RegisteredEditorPriority {
		return usingPositronNotebooks(this.configurationService)
			? RegisteredEditorPriority.exclusive
			: RegisteredEditorPriority.option;
	}

	private registerNotebookEditor(info: NotebookEditorRegistration): void {
		const editorInfo: RegisteredEditorInfo = {
			id: POSITRON_NOTEBOOK_EDITOR_ID,
			label: localize('positronNotebook', "Positron Notebook"),
			detail: info.detail,
			priority: this.getPriority(),
		};
		const cellEditorInfo: RegisteredEditorInfo = {
			...editorInfo,
			priority: this.getCellPriority(),
		};

		// Listen for configuration changes to update priorities dynamically
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(POSITRON_NOTEBOOK_ENABLED_KEY)) {
				editorInfo.priority = this.getPriority();
				cellEditorInfo.priority = this.getCellPriority();
			}
		}));

		// Register file editor
		this._register(this.editorResolverService.registerEditor(
			info.globPattern,
			editorInfo,
			{
				singlePerResource: true,
				canSupportResource: (resource: URI) => {
					return extname(resource) === info.extension &&
						(resource.scheme === Schemas.untitled ||
							resource.scheme === Schemas.vscodeNotebookCell ||
							this.fileService.hasProvider(resource));
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
						info.viewType,
					);
					return { editor: notebookEditorInput, options };
				},
				createEditorInput: ({ resource, options }) => {
					const notebookEditorInput = PositronNotebookEditorInput.getOrCreate(
						this.instantiationService,
						resource,
						undefined,
						info.viewType,
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

		// Register cell editor
		this._register(this.editorResolverService.registerEditor(
			`${Schemas.vscodeNotebookCell}:/**/*${info.extension}`,
			// The cell handler is specifically for opening and focusing a cell by URI
			// e.g. vscode.window.showTextDocument(cell.document).
			// The editor resolver service expects a single handler with 'exclusive' priority.
			// This one is only registered if Positron notebooks are enabled.
			// This does not seem to be an issue for file schemes (registered above).
			cellEditorInfo,
			{
				singlePerResource: true,
				canSupportResource: (resource: URI) => {
					return extname(resource) === info.extension &&
						resource.scheme === Schemas.vscodeNotebookCell;
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
						info.viewType,
					);
					// Create notebook editor options from base text editor options
					const notebookEditorOptions: IPositronNotebookEditorOptions = {
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
		@INotebookService private readonly notebookService: INotebookService
	) {
		super();

		this.installHandler();
	}

	private async installHandler(): Promise<void> {
		await this.extensionService.whenInstalledExtensionsRegistered();
		this._register(this.workingCopyEditorService.registerHandler(this));
	}

	async handles(workingCopy: IWorkingCopyIdentifier): Promise<boolean> {
		// Handle .ipynb files
		const path = workingCopy.resource.path;
		if (!path.endsWith('.ipynb')) {
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
		const viewType = this.getViewType(workingCopy) ?? inferViewTypeFromExtension(workingCopy.resource);
		if (!viewType) {
			throw new Error(`Unsupported file type for Positron notebook editor: ${workingCopy.resource.toString()}`);
		}
		return PositronNotebookEditorInput.getOrCreate(
			this.instantiationService,
			workingCopy.resource,
			undefined,
			viewType,
			{
				// Mark as dirty since we're restoring from a backup
				startDirty: true,
				_workingCopy: workingCopy
			},
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

// Register the prompt that invites users to try the native notebook editor
registerWorkbenchContribution2(PositronNotebookPromptContribution.ID, PositronNotebookPromptContribution, WorkbenchPhase.AfterRestored);



type SerializedPositronNotebookEditorData = { resource: URI; viewType?: string; options?: PositronNotebookEditorInputOptions };
class PositronNotebookEditorSerializer implements IEditorSerializer {
	canSerialize(): boolean {
		return true;
	}
	serialize(input: EditorInput): string {
		assertType(input instanceof PositronNotebookEditorInput);
		const data: SerializedPositronNotebookEditorData = {
			resource: input.resource,
			viewType: input.viewType,
			options: input.options
		};
		return JSON.stringify(data);
	}
	deserialize(instantiationService: IInstantiationService, raw: string) {
		const data = <SerializedPositronNotebookEditorData>parse(raw);
		const { resource, options } = data;
		if (!data || !URI.isUri(resource)) {
			return undefined;
		}

		// Use persisted viewType, falling back to extension-based inference
		// for backwards compatibility with existing serialized data
		const viewType = data.viewType ?? inferViewTypeFromExtension(resource);
		if (!viewType) {
			return undefined;
		}
		return PositronNotebookEditorInput.getOrCreate(instantiationService, resource, undefined, viewType, options);
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	POSITRON_NOTEBOOK_EDITOR_INPUT_ID,
	PositronNotebookEditorSerializer
);


//#region Notebook Commands
export class SelectUpAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.selectUp',
			title: localize2('positronNotebook.selectUp', "Move Focus Up"),
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.UpArrow,
				secondary: [KeyCode.KeyK]
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.selectionStateMachine.moveSelectionUp(false);
	}
}
registerAction2(SelectUpAction);

export class SelectDownAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.selectDown',
			title: localize2('positronNotebook.selectDown', "Move Focus Down"),
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.DownArrow,
				secondary: [KeyCode.KeyJ]
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.selectionStateMachine.moveSelectionDown(false);
	}
}
registerAction2(SelectDownAction);

export class AddSelectionDownAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.addSelectionDown',
			title: localize2('positronNotebook.addSelectionDown', "Extend Selection Down"),
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Shift | KeyCode.DownArrow,
				secondary: [KeyMod.Shift | KeyCode.KeyJ]
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.selectionStateMachine.moveSelectionDown(true);
	}
}
registerAction2(AddSelectionDownAction);

export class AddSelectionUpAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.addSelectionUp',
			title: localize2('positronNotebook.addSelectionUp', "Extend Selection Up"),
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Shift | KeyCode.UpArrow,
				secondary: [KeyMod.Shift | KeyCode.KeyK]
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.selectionStateMachine.moveSelectionUp(true);
	}
}
registerAction2(AddSelectionUpAction);

// Enter key: Enter edit mode when cell is selected but NOT editing
export class EnterEditModeAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.edit',
			title: localize2('positronNotebook.cell.edit', "Enter Cell Edit Mode"),
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Enter
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const focusedCell = notebook.getFocusedCell();
		notebook.selectionStateMachine.enterEditor(focusedCell ?? undefined).catch(err => {
			console.error('Error entering editor:', err);
		});
	}
}
registerAction2(EnterEditModeAction);

/**
 * Escape key: Exit edit mode when cell editor is focused.
 * This command handles the keybinding for all cell types.
 *
 * This action has a counterpart command called
 * `positronNotebook.cell.viewMarkdown` that is
 * used to contribute the same functionality to markdown
 * cell action bars. We should keep both commands in sync
 * to ensure consistent behavior.
 */
export class ExitEditModeAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.quitEdit',
			title: localize2('positronNotebook.cell.quitEdit', "Exit Cell Edit Mode"),
			keybinding: {
				when: ContextKeyExpr.and(
					NotebookContextKeys.cellEditorFocused,
					// Don't exit when multiple selections are active (escape should cancel multi selection first #10385)
					EditorContextKeys.hasMultipleSelections.toNegated(),
					// Don't exit when text is selected (escape should deselect first)
					EditorContextKeys.hasNonEmptySelection.toNegated(),
					// Don't exit when a hover tooltip is shown (escape should dismiss hover first)
					EditorContextKeys.hoverVisible.toNegated()
				),
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Escape
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		// check if we are in editing mode
		if (state.type === SelectionState.EditingSelection) {
			// get the active cell that is being edited
			const cell = state.active;
			// handle markdown cells differently
			if (cell.isMarkdownCell() && cell.editorShown.get()) {
				// This handles updating selection state and closing the editor
				cell.toggleEditor();
			} else {
				notebook.selectionStateMachine.exitEditor();
			}
		}
	}
}
registerAction2(ExitEditModeAction);

/**
 * Escape key: Reduce multi-selection to just the active cell when in command mode.
 * This allows users to quickly collapse a multi-selection back to a single cell.
 */
export class ReduceSelectionToActiveCellAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.reduceSelectionToActiveCell',
			title: localize2('positronNotebook.reduceSelectionToActiveCell', "Reduce Selection to Active Cell"),
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Escape
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		// Only reduce multi-selection; single selection and no cells state remain unchanged
		if (state.type === SelectionState.MultiSelection) {
			// Reduce to a single selection with just the active cell
			notebook.selectionStateMachine.selectCell(state.active);
		}
	}
}
registerAction2(ReduceSelectionToActiveCellAction);

// Z key: Undo in command mode (Jupyter-style)
// Adds keybinding to existing 'undo' command that's handled by contrib/undoRedo/positronNotebookUndoRedo.ts
KeybindingsRegistry.registerKeybindingRule({
	id: 'undo',
	weight: KeybindingWeight.EditorContrib,
	when: POSITRON_NOTEBOOK_COMMAND_MODE,
	primary: KeyCode.KeyZ,
});

// Shift+Z key: Redo in command mode (Jupyter-style)
// Adds keybinding to existing 'redo' command that's handled by contrib/undoRedo/positronNotebookUndoRedo.ts
KeybindingsRegistry.registerKeybindingRule({
	id: 'redo',
	weight: KeybindingWeight.EditorContrib,
	when: POSITRON_NOTEBOOK_COMMAND_MODE,
	primary: KeyMod.Shift | KeyCode.KeyZ
});

// Shift+L: Toggle line numbers in command mode (Jupyter-style)
export class ToggleLineNumbersAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.toggleLineNumbers',
			title: localize2('positronNotebook.toggleLineNumbers', "Toggle Line Numbers"),
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Shift | KeyCode.KeyL
			},
			grabFocusOnRun: false
		});
	}
	override runNotebookAction(_notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
		const configurationService = accessor.get(IConfigurationService);
		const current = configurationService.getValue<'on' | 'off'>('notebook.lineNumbers') === 'on';
		configurationService.updateValue('notebook.lineNumbers', current ? 'off' : 'on');
	}
}
registerAction2(ToggleLineNumbersAction);

// 1-6: Change cell to heading level (Jupyter-style)
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.changeToHeading1',
			title: localize2('positronNotebook.cell.changeToHeading1', "Change Cell to Heading 1"),
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Digit1
			}
		});
	}
	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.changeToHeading(1);
	}
});

registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.changeToHeading2',
			title: localize2('positronNotebook.cell.changeToHeading2', "Change Cell to Heading 2"),
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Digit2
			}
		});
	}
	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.changeToHeading(2);
	}
});

registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.changeToHeading3',
			title: localize2('positronNotebook.cell.changeToHeading3', "Change Cell to Heading 3"),
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Digit3
			}
		});
	}
	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.changeToHeading(3);
	}
});

registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.changeToHeading4',
			title: localize2('positronNotebook.cell.changeToHeading4', "Change Cell to Heading 4"),
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Digit4
			}
		});
	}
	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.changeToHeading(4);
	}
});

registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.changeToHeading5',
			title: localize2('positronNotebook.cell.changeToHeading5', "Change Cell to Heading 5"),
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Digit5
			}
		});
	}
	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.changeToHeading(5);
	}
});

registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.changeToHeading6',
			title: localize2('positronNotebook.cell.changeToHeading6', "Change Cell to Heading 6"),
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Digit6
			}
		});
	}
	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.changeToHeading(6);
	}
});

// I+I: Interrupt kernel in command mode (Jupyter-style)
export class InterruptKernelAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.interruptKernel',
			title: localize2('positronNotebook.interruptKernel', "Interrupt Kernel"),
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyChord(KeyCode.KeyI, KeyCode.KeyI)
			}
		});
	}
	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.interruptKernel();
	}
}
registerAction2(InterruptKernelAction);

// o: Toggle output of selected cell in command mode (Jupyter-style)
export class ToggleOutputAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.toggleOutput',
			title: localize2('positronNotebook.cell.toggleOutput', "Toggle Cell Output"),
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.KeyO
			}
		});
	}
	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (cell?.isCodeCell()) {
			cell.toggleOutputCollapse();
		}
	}
}
registerAction2(ToggleOutputAction);

// Shift+O: Toggle cell output scrolling in command mode (Jupyter-style)
export class ToggleOutputScrollAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.toggleOutputScroll',
			title: localize2('positronNotebook.cell.toggleOutputScroll', "Toggle Cell Output Scrolling"),
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Shift | KeyCode.KeyO
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (cell?.isCodeCell()) {
			cell.toggleOutputScroll();
		}
	}
}
registerAction2(ToggleOutputScrollAction);

// Cmd+A / Ctrl+A: Select all cells in command mode (Jupyter-style)
export class SelectAllCellsAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.selectAllCells',
			title: localize2('positronNotebook.selectAllCells', "Select All Cells"),
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KeyA
			}
		});
	}
	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.selectAllCells();
	}
}
registerAction2(SelectAllCellsAction);

//#endregion Notebook Commands

//#region Cell Commands
// Register delete command with UI in one call
// For built-in commands, we don't need to manage the disposable since they live
// for the lifetime of the application

registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.insertCodeCellAboveAndFocusContainer',
			title: localize2('positronNotebook.codeCell.insertAbove', "Insert Code Cell Above"),
			icon: ThemeIcon.fromId('arrow-up'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.Insert,
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.Insert,
			}],
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.KeyA
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (cell) {
			cell.insertCodeCellAbove();
		} else {
			// Empty notebook: add a code cell
			notebook.addCell(CellKind.Code, 0, false);
		}
	}
});

registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.insertCodeCellBelowAndFocusContainer',
			title: localize2('positronNotebook.codeCell.insertBelow', "Insert Code Cell Below"),
			icon: ThemeIcon.fromId('arrow-down'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.Insert,
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.Insert,
			}],
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.KeyB
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (cell) {
			cell.insertCodeCellBelow();
		} else {
			// Empty notebook: add a code cell
			notebook.addCell(CellKind.Code, 0, false);
		}
	}
});

registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.insertMarkdownCellAboveAndFocusContainer',
			title: localize2('positronNotebook.markdownCell.insertAbove', "Insert Markdown Cell Above"),
			icon: ThemeIcon.fromId('arrow-up'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.Insert,
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.Insert,
			}]
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (cell) {
			cell.insertMarkdownCellAbove();
		}
	}
});

registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.insertMarkdownCellBelowAndFocusContainer',
			title: localize2('positronNotebook.markdownCell.insertBelow', "Insert Markdown Cell Below"),
			icon: ThemeIcon.fromId('arrow-down'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.Insert,
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.Insert,
			}]
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (cell) {
			cell.insertMarkdownCellBelow();
		}
	}
});

registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.insertRawCellAbove',
			title: localize2('positronNotebook.rawCell.insertAbove', "Insert Raw Cell Above"),
			icon: ThemeIcon.fromId('arrow-up'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.Insert,
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.Insert,
			}]
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (cell) {
			cell.insertRawCellAbove();
		}
	}
});

registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.insertRawCellBelow',
			title: localize2('positronNotebook.rawCell.insertBelow', "Insert Raw Cell Below"),
			icon: ThemeIcon.fromId('arrow-down'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.Insert,
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.Insert,
			}]
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (cell) {
			cell.insertRawCellBelow();
		}
	}
});

export class DeleteCellAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.delete',
			title: localize2('positronNotebook.cell.delete.description', "Delete Cell"),
			icon: ThemeIcon.fromId('trash'),
			menu: {
				id: MenuId.PositronNotebookCellActionBarRight,
				order: 100,
				group: 'Cell'
			},
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.Backspace,
				secondary: [KeyChord(KeyCode.KeyD, KeyCode.KeyD)]
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.deleteCells();
	}
}
registerAction2(DeleteCellAction);

// Make sure the run and stop commands are in the same place so they replace one another.
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: POSITRON_EXECUTE_CELL_COMMAND_ID,
			title: localize2('positronNotebook.cell.execute', "Run Cell"),
			icon: ThemeIcon.fromId('notebook-execute'),
			menu: {
				id: MenuId.PositronNotebookCellActionBarLeft,
				group: PositronNotebookCellActionBarLeftGroup.Primary,
				order: 1, // gauranteed to be the first item in the cell action bar
				when: ContextKeyExpr.and(
					CellContextKeys.isCode.isEqualTo(true),
					CellContextKeys.isRunning.toNegated(),
					CellContextKeys.isPending.toNegated()
				)
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (cell) {
			cell.run();
		}
	}
});

registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.stopExecution',
			title: localize2('positronNotebook.cell.stopExecution', "Stop Cell Execution"),
			icon: ThemeIcon.fromId('primitive-square'),
			menu: {
				id: MenuId.PositronNotebookCellActionBarLeft,
				group: PositronNotebookCellActionBarLeftGroup.Primary,
				order: 1, // gauranteed to be the first item in the cell action bar
				when: ContextKeyExpr.and(
					CellContextKeys.isCode.isEqualTo(true),
					ContextKeyExpr.or(
						CellContextKeys.isRunning.isEqualTo(true),
						CellContextKeys.isPending.isEqualTo(true)
					)
				)
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (cell) {
			cell.run(); // Run called when cell is executing is stop
		}
	}
});

registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.debug',
			title: localize2('positronNotebook.cell.debug', "Debug Cell"),
			icon: ThemeIcon.fromId('debug-alt-small'),
			menu: {
				id: MenuId.PositronNotebookCellActionBarLeft,
				order: 10,
				when: CellContextKeys.isCode
			},
			keybinding: {
				when: NotebookContextKeys.editorFocused,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Alt | KeyMod.Shift | KeyCode.Enter
			}
		});
	}

	override async runNotebookAction(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);

		if (cell) {
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
	}
});

// Run all code cells above the current cell (including the current cell)
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.runAllAbove',
			title: localize2('positronNotebook.cell.runAllAbove', "Run Cells Above"),
			icon: ThemeIcon.fromId('run-above'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarLeft,
				order: 20,
				when: ContextKeyExpr.and(
					CellContextKeys.isCode.isEqualTo(true),
					CellContextKeys.isFirst.toNegated()
				)
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.Execution,
				order: 10,
				when: ContextKeyExpr.and(
					CellContextKeys.isCode.isEqualTo(true),
					CellContextKeys.isFirst.toNegated()
				)
			}]
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);

		if (cell) {
			const cells = notebook.cells.get();

			// Run all code cells above the current cell (including the current cell)
			const cellIndex = cell.index;
			for (let i = 0; i <= cellIndex; i++) {
				const targetCell = cells[i];
				if (targetCell.isCodeCell()) {
					targetCell.run();
				}
			}
		}
	}
});

// Run all code cells below the current cell (including the current cell)
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.runAllBelow',
			title: localize2('positronNotebook.cell.runAllBelow', "Run Cells Below"),
			icon: ThemeIcon.fromId('run-below'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarLeft,
				order: 21,
				when: ContextKeyExpr.and(
					CellContextKeys.isCode.isEqualTo(true),
					CellContextKeys.isLast.toNegated()
				)
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.Execution,
				order: 20,
				when: ContextKeyExpr.and(
					CellContextKeys.isCode.isEqualTo(true),
					CellContextKeys.isLast.toNegated()
				)
			}]
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);

		if (cell) {
			const cells = notebook.cells.get();

			// Run all code cells below the current cell (including the current cell)
			for (let i = cell.index; i < cells.length; i++) {
				const targetCell = cells[i];
				if (targetCell.isCodeCell()) {
					targetCell.run();
				}
			}
		}
	}
});

// Open markdown editor (For action bar)
export class OpenMarkdownEditorAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.openMarkdownEditor',
			title: localize2('positronNotebook.cell.openMarkdownEditor', "Open Markdown Editor"),
			icon: ThemeIcon.fromId('edit'),
			menu: {
				id: MenuId.PositronNotebookCellActionBarLeft,
				group: PositronNotebookCellActionBarLeftGroup.Primary,
				order: 10,
				when: ContextKeyExpr.and(
					CellContextKeys.isMarkdown.isEqualTo(true),
					CellContextKeys.markdownEditorOpen.toNegated()
				)
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (cell && cell.isMarkdownCell()) {
			// This test is just to appease typescript, we know it's a markdown cell
			cell.toggleEditor();
		}
	}
}
registerAction2(OpenMarkdownEditorAction);

/**
 * View markdown (For action bar)
 *
 * Handles contributing the behavior of
 * `positronNotebook.cell.quitEdit` to markdown cell
 * action bar. We should keep both commands in sync to
 * ensure consistent behavior.
 */
export class ViewMarkdownAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.viewMarkdown',
			title: localize2('positronNotebook.cell.viewMarkdown', "View Markdown"),
			icon: ThemeIcon.fromId('check'),
			menu: {
				id: MenuId.PositronNotebookCellActionBarLeft,
				group: PositronNotebookCellActionBarLeftGroup.Primary,
				order: 10,
				when: ContextKeyExpr.and(
					CellContextKeys.isMarkdown.isEqualTo(true),
					CellContextKeys.markdownEditorOpen.isEqualTo(true)
				)
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (cell && cell.isMarkdownCell()) {
			// This test is just to appease typescript, we know it's a markdown cell
			cell.toggleEditor();
		}
	}
}
registerAction2(ViewMarkdownAction);


// Keyboard shortcut commands. These are not shown in the action bar.
// TODO: Improve the context key support so we don't need to have a single command per
// the keyboard shortcut and can reuse the action bar commands. Cell agnostic
// "Execute in place" command.
export class ExecuteOrToggleEditorAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.executeOrToggleEditor',
			title: localize2('positronNotebook.cell.executeOrToggleEditor', "Execute Cell or Toggle Editor"),
			keybinding: {
				when: NotebookContextKeys.editorFocused,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.CtrlCmd | KeyCode.Enter
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);

		if (cell) {
			if (cell.isMarkdownCell()) {
				cell.toggleEditor();
			} else {
				// This also stops if the cell is running.
				cell.run();
			}
		}
	}
}
registerAction2(ExecuteOrToggleEditorAction);


/**
 * Resolves the active cell, executes it, and exits edit/markdown-preview mode.
 * Shared by the Shift+Enter and Alt+Enter notebook actions.
 * Returns the cell so callers can decide what to do next, or `null` if there
 * is no active cell.
 */
function executeActiveCell(notebook: IPositronNotebookInstance): IPositronNotebookCell | null {
	const state = notebook.selectionStateMachine.state.get();
	const cell = getActiveCell(state);
	if (!cell) {
		return null;
	}

	// Exit edit mode if we're in it
	if (state.type === SelectionState.EditingSelection) {
		notebook.selectionStateMachine.exitEditor();
	}

	// Execute the cell only if it's a code cell. Otherwise the user would
	// have to double call for markdown cells to open and then close the editor.
	if (cell.isCodeCell()) {
		cell.run();
	}

	// If the cell is a markdown cell and the editor is open, close it.
	if (cell.isMarkdownCell() && cell.editorShown.get()) {
		cell.toggleEditor();
	}

	return cell;
}

// Execute cell and select below
export class ExecuteAndSelectBelowAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.executeAndSelectBelow',
			title: localize2('positronNotebook.cell.executeAndSelectBelow', "Execute Cell and Select Below"),
			keybinding: {
				when: NotebookContextKeys.editorFocused,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Shift | KeyCode.Enter
			}
		});
	}

	override async runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const state = notebook.selectionStateMachine.state.get();

		// When multiple cells are selected, run all selected code cells
		// and keep the multi-selection intact.
		if (state.type === SelectionState.MultiSelection) {
			const codeCells = getSelectedCells(state)
				.filter(cell => cell.isCodeCell())
				.sort((a, b) => a.index - b.index);
			if (codeCells.length > 0) {
				await notebook.runCells(codeCells);
			}
			return;
		}

		const cell = executeActiveCell(notebook);
		if (!cell) {
			return;
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
}
registerAction2(ExecuteAndSelectBelowAction);

// Execute cell, insert a new cell below, and focus it (Alt+Enter, Jupyter-style)
export class ExecuteAndInsertBelowAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.executeAndInsertBelow',
			title: localize2('positronNotebook.cell.executeAndInsertBelow', "Execute Cell and Insert Below"),
			keybinding: {
				when: NotebookContextKeys.editorFocused,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Alt | KeyCode.Enter
			}
		});
	}

	override async runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		const cell = executeActiveCell(notebook);
		if (!cell) {
			return;
		}

		// Always insert a new cell below of the same type and focus it
		notebook.addCell(cell.kind, cell.index + 1, true);
	}
}
registerAction2(ExecuteAndInsertBelowAction);

// Copy cells command - C (Jupyter-style)
export class CopyCellsAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.copyCells',
			title: localize2('positronNotebook.cell.copyCells', "Copy Cell"),
			icon: ThemeIcon.fromId('copy'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.Clipboard,
				order: 20
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.Clipboard,
				order: 20
			}],
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.KeyC
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.copyCells();
	}
}
registerAction2(CopyCellsAction);

// Cut cells command - X (Jupyter-style)
export class CutCellsAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cutCells',
			title: localize2('positronNotebook.cell.cutCells', "Cut Cell"),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.Clipboard,
				order: 10
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.Clipboard,
				order: 10
			}],
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.KeyX
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.cutCells();
	}
}
registerAction2(CutCellsAction);

// Paste cells command - V (Jupyter-style)
export class PasteCellsAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.pasteCells',
			title: localize2('positronNotebook.cell.pasteCells', "Paste Cell Below"),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.Clipboard,
				order: 40
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.Clipboard,
				order: 40
			}],
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.KeyV
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.pasteCells();
	}
}
registerAction2(PasteCellsAction);

// Paste cells above command - Shift+V (Jupyter-style)
export class PasteCellsAboveAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.pasteCellsAbove',
			title: localize2('positronNotebook.cell.pasteCellsAbove', "Paste Cell Above"),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.Clipboard,
				order: 30
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.Clipboard,
				order: 30
			}],
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Shift | KeyCode.KeyV
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.pasteCellsAbove();
	}
}
registerAction2(PasteCellsAboveAction);

// Move selected cells up
export class MoveCellUpAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.moveUp',
			title: localize2('positronNotebook.cell.moveUp', "Move Cell Up"),
			icon: ThemeIcon.fromId('arrow-up'),
			menu: {
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				order: 10,
				group: PositronNotebookCellActionGroup.Order,
				when: CellContextKeys.canMoveUp
			},
			keybinding: {
				when: NotebookContextKeys.editorFocused,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Alt | KeyCode.UpArrow,
				// WinCtrl is literal Ctrl on macOS (Cmd on Win/Linux), so both Cmd+Shift
				// and Ctrl+Shift move cells on macOS, matching JupyterLab's Ctrl+Shift.
				secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.UpArrow, KeyMod.WinCtrl | KeyMod.Shift | KeyCode.UpArrow]
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.moveCellsUp();
	}
}
registerAction2(MoveCellUpAction);

// Move selected cells down
export class MoveCellDownAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.moveDown',
			title: localize2('positronNotebook.cell.moveDown', "Move Cell Down"),
			icon: ThemeIcon.fromId('arrow-down'),
			menu: {
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				order: 20,
				group: PositronNotebookCellActionGroup.Order,
				when: CellContextKeys.canMoveDown
			},
			keybinding: {
				when: NotebookContextKeys.editorFocused,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Alt | KeyCode.DownArrow,
				// WinCtrl is literal Ctrl on macOS (Cmd on Win/Linux), so both Cmd+Shift
				// and Ctrl+Shift move cells on macOS, matching JupyterLab's Ctrl+Shift.
				secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.DownArrow, KeyMod.WinCtrl | KeyMod.Shift | KeyCode.DownArrow]
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.moveCellsDown();
	}
}
registerAction2(MoveCellDownAction);

// Change to Code cell - y key (Jupyter-style)
export class ChangeToCodeAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.changeToCode',
			title: localize2('positronNotebook.cell.changeToCode', "Change to Code"),
			icon: ThemeIcon.fromId('code'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.CellType,
				order: 10,
				when: ContextKeyExpr.or(CellContextKeys.isCode.toNegated(), CellContextKeys.isRaw)
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.CellType,
				order: 10,
				when: ContextKeyExpr.or(CellContextKeys.isCode.toNegated(), CellContextKeys.isRaw)
			}],
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.KeyY
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		// Change to code cell with kernel's default language
		const kernelLanguage = notebook.kernel.get()?.supportedLanguages?.[0];
		notebook.changeCellType(CellKind.Code, kernelLanguage);
	}
}
registerAction2(ChangeToCodeAction);

// Change to Markdown cell - m key (Jupyter-style)
export class ChangeToMarkdownAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.changeToMarkdown',
			title: localize2('positronNotebook.cell.changeToMarkdown', "Change to Markdown"),
			icon: ThemeIcon.fromId('markdown'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.CellType,
				order: 20,
				when: CellContextKeys.isMarkdown.toNegated()
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.CellType,
				order: 20,
				when: CellContextKeys.isMarkdown.toNegated()
			}],
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.KeyM
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.changeCellType(CellKind.Markup);
	}
}
registerAction2(ChangeToMarkdownAction);

// Change to Raw cell - r key (Jupyter-style)
export class ChangeToRawAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.changeToRaw',
			title: localize2('positronNotebook.cell.changeToRaw', "Change to Raw"),
			icon: ThemeIcon.fromId('file-code'),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.CellType,
				order: 30,
				when: CellContextKeys.isRaw.toNegated()
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.CellType,
				order: 30,
				when: CellContextKeys.isRaw.toNegated()
			}],
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.KeyR
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.changeCellType(CellKind.Code, 'raw');
	}
}
registerAction2(ChangeToRawAction);

// Split cell at cursor position(s)
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.split',
			title: localize2('positronNotebook.cell.split', "Split Cell"),
			menu: [{
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.CellType,
				order: 40,
				when: NotebookContextKeys.cellEditorFocused,
			}],
			keybinding: {
				when: NotebookContextKeys.cellEditorFocused,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Minus
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.splitCell();
	}
});

// Join selected cells - Shift+M (Jupyter-style)
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.joinSelected',
			title: localize2('positronNotebook.cell.joinSelected', "Join Selected Cells"),
			menu: [{
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.CellType,
				order: 50,
			}],
			keybinding: {
				when: POSITRON_NOTEBOOK_COMMAND_MODE,
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.Shift | KeyCode.KeyM
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.joinSelectedCells();
	}
});

// Join with cell above
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.joinAbove',
			title: localize2('positronNotebook.cell.joinAbove', "Join with Cell Above"),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.CellType,
				order: 60,
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.CellType,
				order: 60,
			}],
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.joinCellAbove();
	}
});

// Join with cell below
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.joinBelow',
			title: localize2('positronNotebook.cell.joinBelow', "Join with Cell Below"),
			menu: [{
				id: MenuId.PositronNotebookCellActionBarSubmenu,
				group: PositronNotebookCellActionGroup.CellType,
				order: 70,
			}, {
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.CellType,
				order: 70,
			}],
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.joinCellBelow();
	}
});

// Truncate output
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.truncateOutput',
			title: localize2('positronNotebook.cell.truncateOutput', "Truncate Output"),
			icon: Codicon.fold,
			menu: [
				{
					id: MenuId.PositronNotebookCellOutputActionBar,
					group: PositronNotebookCellOutputActionGroup.Visibility,
					order: 0,
					when: ContextKeyExpr.and(
						CellContextKeys.hasOutputs,
						CellContextKeys.outputIsCollapsed.toNegated(),
						CellContextKeys.outputOverflows,
						CellContextKeys.outputScrolling
					)
				},
				{
					id: MenuId.PositronNotebookCellOutputActionContext,
					group: PositronNotebookCellOutputActionGroup.Visibility,
					order: 0,
					when: ContextKeyExpr.and(
						CellContextKeys.hasOutputs,
						CellContextKeys.outputIsCollapsed.toNegated(),
						CellContextKeys.outputOverflows,
						CellContextKeys.outputScrolling
					)
				}
			]
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor): void {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (cell?.isCodeCell()) {
			cell.truncateOutput();
		}
	}
});

// Show full output
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.showFullOutput',
			title: localize2('positronNotebook.cell.showFullOutput', "Show Full Output"),
			icon: Codicon.unfold,
			menu: [
				{
					id: MenuId.PositronNotebookCellOutputActionBar,
					group: PositronNotebookCellOutputActionGroup.Visibility,
					order: 0,
					when: ContextKeyExpr.and(
						CellContextKeys.hasOutputs,
						CellContextKeys.outputIsCollapsed.toNegated(),
						CellContextKeys.outputOverflows,
						CellContextKeys.outputScrolling.toNegated()
					)
				},
				{
					id: MenuId.PositronNotebookCellOutputActionContext,
					group: PositronNotebookCellOutputActionGroup.Visibility,
					order: 0,
					when: ContextKeyExpr.and(
						CellContextKeys.hasOutputs,
						CellContextKeys.outputIsCollapsed.toNegated(),
						CellContextKeys.outputOverflows,
						CellContextKeys.outputScrolling.toNegated()
					)
				}
			]
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor): void {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (cell?.isCodeCell()) {
			cell.showFullOutput();
		}
	}
});

// Collapse all outputs for a cell
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.collapseOutput',
			title: localize2('positronNotebook.cell.collapseOutput', "Collapse Output"),
			icon: Codicon.chevronDown,
			menu: {
				id: MenuId.PositronNotebookCellOutputActionContext,
				group: PositronNotebookCellOutputActionGroup.Visibility,
				order: 1,
				when: ContextKeyExpr.and(
					CellContextKeys.hasOutputs,
					CellContextKeys.outputIsCollapsed.toNegated()
				)
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor): void {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (cell?.isCodeCell()) {
			cell.collapseOutput();
		}
	}
});

// Expand all outputs for a cell
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.expandOutput',
			title: localize2('positronNotebook.cell.expandOutput', "Expand Output"),
			icon: Codicon.chevronRight,
			menu: {
				id: MenuId.PositronNotebookCellOutputActionContext,
				group: PositronNotebookCellOutputActionGroup.Visibility,
				order: 2,
				when: ContextKeyExpr.and(
					CellContextKeys.hasOutputs,
					CellContextKeys.outputIsCollapsed
				)
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor): void {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (cell?.isCodeCell()) {
			cell.expandOutput();
		}
	}
});

// Clear output for a cell
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.clearOutput',
			title: localize2('positronNotebook.cell.clearOutput', "Clear Output"),
			icon: Codicon.clearAll,
			menu: [
				{
					id: MenuId.PositronNotebookCellOutputActionBar,
					group: PositronNotebookCellOutputActionGroup.Destructive,
					order: 1,
				},
				{
					id: MenuId.PositronNotebookCellOutputActionContext,
					group: PositronNotebookCellOutputActionGroup.Destructive,
					order: 1,
					when: CellContextKeys.hasOutputs
				},
			]
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor): void {
		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (cell?.isCodeCell()) {
			notebook.clearCellOutput(cell);
		}
	}
});

// Copy output (unified Cmd+C when output is focused)
export class CopyOutputAction extends NotebookAction2 {
	constructor() {
		super({
			id: PositronNotebookActionId.CopyOutput,
			title: localize2('positronNotebook.cell.copyOutput', "Copy Output"),
			grabFocusOnRun: false,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.KeyC,
				when: ContextKeyExpr.and(
					NotebookContextKeys.editorFocused,
					CellContextKeys.outputFocused,
					CellContextKeys.hasOutputs,
					CellContextKeys.outputIsCollapsed.toNegated(),
				),
				weight: KeybindingWeight.EditorContrib,
			},
		});
	}

	override async runNotebookAction(notebook: IPositronNotebookInstance, accessor: ServicesAccessor): Promise<void> {
		const clipboardService = accessor.get(IClipboardService);
		const logService = accessor.get(ILogService);
		const notificationService = accessor.get(INotificationService);

		const state = notebook.selectionStateMachine.state.get();
		const cell = getActiveCell(state);
		if (!cell?.isCodeCell()) {
			return;
		}

		const outputs = cell.outputs.get();

		const win = getActiveWindow();
		const focusedElement = win.document.activeElement;

		// Editable controls: execute native copy and bail out
		if (focusedElement && (isEditableElement(focusedElement) ||
			(isHTMLElement(focusedElement) && focusedElement.isContentEditable))) {
			win.document.execCommand('copy');
			return;
		}

		// Priority 1: If there's a text selection entirely within the output, copy it
		const selection = win.document.getSelection();
		if (selection && selection.type === 'Range' && focusedElement &&
			selection.anchorNode && selection.focusNode &&
			focusedElement.contains(selection.anchorNode) &&
			focusedElement.contains(selection.focusNode)) {
			win.document.execCommand('copy');
			return;
		}

		// Priority 2: If the cell has exactly one image output, copy the image
		const imageOutputs = outputs.filter(o => o.parsed.type === 'image');
		if (imageOutputs.length === 1 && imageOutputs[0].parsed.type === 'image') {
			await copyImageToClipboard(imageOutputs[0].parsed.dataUrl, clipboardService, logService, notificationService);
			return;
		}

		// Priority 3: If the cell has exactly one JSON output, copy as formatted JSON
		const jsonOutputs = outputs.filter(o => o.parsed.type === 'json');
		if (jsonOutputs.length === 1 && jsonOutputs[0].parsed.type === 'json') {
			try {
				await clipboardService.writeText(serializeJsonOutput(jsonOutputs[0].parsed.data));
			} catch (err) {
				logService.error('Failed to copy output to clipboard:', err);
				notificationService.error(localize('copyOutputFailed', "Failed to copy output to clipboard"));
			}
			return;
		}

		// Priority 4: Copy all text output content
		if (outputs.some(o => isParsedTextOutput(o.parsed))) {
			try {
				await clipboardService.writeText(getPlainTextOutputContent(outputs));
			} catch (err) {
				logService.error('Failed to copy output to clipboard:', err);
				notificationService.error(localize('copyOutputFailed', "Failed to copy output to clipboard"));
			}
			return;
		}
	}
}
registerAction2(CopyOutputAction);

// Copy output image to clipboard (menu-driven, e.g. right-click on specific image)
class CopyOutputImageAction extends NotebookAction2 {
	constructor() {
		super({
			id: PositronNotebookActionId.CopyOutputImage,
			title: localize2('positronNotebook.cell.copyOutputImage', "Copy Image"),
			icon: ThemeIcon.fromId('copy'),
			grabFocusOnRun: false,
			menu: [
				{
					id: MenuId.PositronNotebookCellOutputActionBar,
					group: PositronNotebookCellOutputActionGroup.Copy,
					order: 1,
					when: ContextKeyExpr.and(
						// Show the static "Copy Image" action only when there is exactly one
						// image output. For multiple images, users can right-click individual
						// images to copy them.
						ContextKeyExpr.equals(CellContextKeys.imageOutputCount.key, 1),
						CellContextKeys.outputIsCollapsed.toNegated()
					)
				},
				{
					id: MenuId.PositronNotebookCellOutputActionContext,
					group: PositronNotebookCellOutputActionGroup.Copy,
					order: 1,
					when: ContextKeyExpr.and(
						CellContextKeys.outputImageTargeted,
						CellContextKeys.outputIsCollapsed.toNegated()
					)
				},
			],
		});
	}

	override async runNotebookAction(notebook: IPositronNotebookInstance, accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const clipboardService = accessor.get(IClipboardService);
		const logService = accessor.get(ILogService);
		const notificationService = accessor.get(INotificationService);

		// Look for a CopyImageMenuArg forwarded from the context menu
		const menuArg = args.find(isCopyImageMenuArg);
		let dataUrl = menuArg?.imageDataUrl;

		// Fall back to the first image output (e.g. from ellipsis menu)
		if (!dataUrl) {
			const state = notebook.selectionStateMachine.state.get();
			const cell = getActiveCell(state);
			if (!cell?.isCodeCell()) {
				return;
			}
			const imageOutput = cell.outputs.get().find(o => o.parsed.type === 'image');
			if (imageOutput?.parsed.type === 'image') {
				dataUrl = imageOutput.parsed.dataUrl;
			}
		}

		if (!dataUrl) {
			return;
		}

		await copyImageToClipboard(dataUrl, clipboardService, logService, notificationService);
	}
}
registerAction2(CopyOutputImageAction);

// Copy JSON output to clipboard
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: PositronNotebookActionId.CopyOutputJson,
			title: localize2('positronNotebook.cell.copyOutputJson', "Copy JSON"),
			icon: ThemeIcon.fromId('copy'),
			menu: [
				{
					id: MenuId.PositronNotebookCellOutputActionBar,
					group: PositronNotebookCellOutputActionGroup.Copy,
					order: 2,
					when: ContextKeyExpr.and(
						ContextKeyExpr.equals(CellContextKeys.jsonOutputCount.key, 1),
						CellContextKeys.outputIsCollapsed.toNegated()
					)
				},
				{
					id: MenuId.PositronNotebookCellOutputActionContext,
					group: PositronNotebookCellOutputActionGroup.Copy,
					order: 2,
					when: ContextKeyExpr.and(
						CellContextKeys.outputJsonTargeted,
						CellContextKeys.outputIsCollapsed.toNegated()
					)
				},
			],
		});
	}

	override async runNotebookAction(notebook: IPositronNotebookInstance, accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const clipboardService = accessor.get(IClipboardService);

		const menuArg = args.find(isCopyJsonMenuArg);
		let text = menuArg?.jsonText;

		if (!text) {
			const state = notebook.selectionStateMachine.state.get();
			const cell = getActiveCell(state);
			if (!cell?.isCodeCell()) {
				return;
			}
			const jsonOutput = cell.outputs.get().find(o => o.parsed.type === 'json');
			if (jsonOutput?.parsed.type !== 'json') {
				return;
			}
			text = serializeJsonOutput(jsonOutput.parsed.data);
		}
		await clipboardService.writeText(text);
	}
});

//#endregion Cell Commands

//#region Notebook Header Actions
// Register notebook-level actions that appear in the editor action bar

// Run All Cells - Executes all code cells in the notebook
export class RunAllCellsAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.runAllCells',
			title: localize2('runAllCells', 'Run All Cells'),
			icon: ThemeIcon.fromId('notebook-execute-all'),
			f1: true,
			category: POSITRON_NOTEBOOK_CATEGORY,
			// Mirror the toolbar `when` so the command palette and the notebook
			// command picker only surface this while nothing is running, matching
			// the run/stop toolbar toggle (stopAllCells gates on the inverse).
			precondition: ContextKeyExpr.and(
				ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
				NOTEBOOK_HAS_SOMETHING_RUNNING.toNegated()
			),
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: false
			},
			menu: {
				id: MenuId.EditorActionsLeft,
				group: 'navigation',
				order: 10,
				when: ContextKeyExpr.and(
					ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
					NOTEBOOK_HAS_SOMETHING_RUNNING.toNegated()
				)
			},
			keybinding: {
				when: ContextKeyExpr.and(
					ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
					NOTEBOOK_HAS_SOMETHING_RUNNING.toNegated()
				),
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		return notebook.runAllCells();
	}
}

// Stop All Cells - cancels execution of every running cell.
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.stopAllCells',
			title: localize2('stopAllCells', 'Stop Execution'),
			icon: ThemeIcon.fromId('primitive-square'),
			f1: true,
			category: POSITRON_NOTEBOOK_CATEGORY,
			// Mirror the toolbar `when` so the command palette and the notebook
			// command picker only surface this while something is running. Without
			// it the picker showed "Stop Execution" when idle, and selecting it ran
			// all cells (runNotebookAction delegates to runAllCells, which only
			// cancels when there are live executions to see).
			precondition: ContextKeyExpr.and(
				ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
				NOTEBOOK_HAS_SOMETHING_RUNNING
			),
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: false
			},
			menu: {
				id: MenuId.EditorActionsLeft,
				group: 'navigation',
				order: 10,
				when: ContextKeyExpr.and(
					ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
					NOTEBOOK_HAS_SOMETHING_RUNNING
				)
			},
			keybinding: {
				when: ContextKeyExpr.and(
					ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
					NOTEBOOK_HAS_SOMETHING_RUNNING
				),
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		// runAllCells delegates to _runCells, which sees the live executions and
		// routes to cancelNotebookCells instead of executeNotebookCells.
		return notebook.runAllCells();
	}
});
registerAction2(RunAllCellsAction);

// Clear All Outputs - Clears outputs from all cells
export class ClearAllOutputsAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.clearAllOutputs',
			title: localize2('clearAllOutputs', 'Clear All Outputs'),
			icon: ThemeIcon.fromId('clear-all'),
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
}
registerAction2(ClearAllOutputsAction);

// Show Console - Opens or focuses the notebook console
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.showConsole',
			title: localize2('showConsole', 'Open Notebook Console'),
			icon: ThemeIcon.fromId('terminal'),
			f1: true,
			category: POSITRON_NOTEBOOK_CATEGORY,
			precondition: ContextKeyExpr.and(
				ActiveNotebookHasRunningRuntime,
				ContextKeyExpr.equals('config.console.showNotebookConsoleActions', true)
			),
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: true
			},
			menu: {
				id: MenuId.PositronNotebookKernelSubmenu,
				order: 100,
				when: ContextKeyExpr.and(
					ActiveNotebookHasRunningRuntime,
					ContextKeyExpr.equals('config.console.showNotebookConsoleActions', true)
				)
			}
		});
	}

	override runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor) {
		notebook.showNotebookConsole();
	}
});

// Add Code Cell - Inserts a new code cell after the active cell
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.addCodeCell',
			title: localize2('addCodeCell', 'Code'),
			tooltip: localize2('addCodeCell.tooltip', 'New Code Cell'),
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
		const state = notebook.selectionStateMachine.state.get();
		if (state.type !== SelectionState.NoCells) {
			// get the active cell
			const cell = state.active;
			// insert a code cell after the active cell
			notebook.addCell(CellKind.Code, cell.index + 1, true);
		} else {
			// If there are no cells, just add a code cell at index 0
			notebook.addCell(CellKind.Code, 0, true);
		}
	}
});

// Add Markdown Cell - Inserts a new markdown cell after the active cell
registerAction2(class extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.addMarkdownCell',
			title: localize2('addMarkdownCell', 'Markdown'),
			tooltip: localize2('addMarkdownCell.tooltip', 'New Markdown Cell'),
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
		const state = notebook.selectionStateMachine.state.get();
		if (state.type !== SelectionState.NoCells) {
			// get the active cell
			const cell = state.active;
			// insert a code cell after the active cell
			notebook.addCell(CellKind.Markup, cell.index + 1, true);
		} else {
			// If there are no cells, just add a code cell at index 0
			notebook.addCell(CellKind.Markup, 0, true);
		}
	}
});

// Toggle Outline - Reveals or hides the Outline view in the Explorer pane
export class ToggleOutlineAction extends Action2 {
	constructor() {
		super({
			id: 'positronNotebook.toggleOutline',
			title: localize2('toggleOutline', 'Toggle Outline'),
			icon: ThemeIcon.fromId('list-unordered'),
			f1: true,
			category: POSITRON_NOTEBOOK_CATEGORY,
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: false
			},
			menu: {
				id: MenuId.EditorActionsLeft,
				group: 'navigation',
				order: 45,
				when: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID)
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		if (viewsService.isViewVisible(IOutlinePane.Id)) {
			viewsService.closeView(IOutlinePane.Id);
		} else {
			await viewsService.openView(IOutlinePane.Id, true);
		}
	}
}
registerAction2(ToggleOutlineAction);

// Ask Assistant - Opens assistant chat with prompt options for the notebook
// Action is defined in AskAssistantAction.ts

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
registerAction2(ExecuteSelectionInCellAction);
registerAction2(ExecuteSelectionInConsoleAction);
registerAction2(UpdateNotebookWorkingDirectoryAction);

// Add the Notebook Cell submenu to the editor context menu (right click in cell editor)
MenuRegistry.appendMenuItem(MenuId.EditorContext, {
	submenu: MenuId.PositronNotebookCellContext,
	title: localize('positronNotebook.menu.editorContext.cell', 'Notebook Cell'),
	group: '2_notebook',
	// Only show these menu items when a notebook editor has focus to
	// avoid these menu items showing up in other editors, such as the
	// output panel (which is a monaco editor).
	when: NotebookContextKeys.editorFocused,
	order: 0
});
