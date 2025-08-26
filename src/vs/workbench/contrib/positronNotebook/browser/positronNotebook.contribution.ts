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
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry, WorkbenchPhase, IWorkbenchContribution, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';

import { parse } from '../../../../base/common/marshalling.js';
import { assertType } from '../../../../base/common/types.js';
import { INotebookService } from '../../notebook/common/notebookService.js';

import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { PositronNotebookEditor } from './PositronNotebookEditor.js';
import { PositronNotebookEditorInput, PositronNotebookEditorInputOptions } from './PositronNotebookEditorInput.js';

import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { IPositronNotebookService } from '../../../services/positronNotebook/browser/positronNotebookService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { checkPositronNotebookEnabled } from './positronNotebookExperimentalConfig.js';
import { IWorkingCopyEditorHandler, IWorkingCopyEditorService } from '../../../services/workingCopy/common/workingCopyEditorService.js';
import { IWorkingCopyIdentifier } from '../../../services/workingCopy/common/workingCopy.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { isEqual } from '../../../../base/common/resources.js';
import { NotebookWorkingCopyTypeIdentifier } from '../../notebook/common/notebookCommon.js';
import { registerCellCommand } from './notebookCells/actionBar/registerCellCommand.js';
import { registerNotebookCommand } from './notebookCells/actionBar/registerNotebookCommand.js';


/**
 * PositronNotebookContribution class.
 */
class PositronNotebookContribution extends Disposable {
	constructor(
		@IEditorResolverService private readonly editorResolverService: IEditorResolverService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@INotebookService private readonly notebookService: INotebookService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();

		// Only register the editor if the feature is enabled
		if (checkPositronNotebookEnabled(this.configurationService)) {
			this.registerEditor();
		}
	}

	private registerEditor(): void {
		// Register for .ipynb files
		this._register(this.editorResolverService.registerEditor(
			'*.ipynb',
			{
				id: PositronNotebookEditorInput.EditorID,
				label: localize('positronNotebook', "Positron Notebook"),
				detail: localize('positronNotebook.detail', "Provided by Positron"),
				priority: RegisteredEditorPriority.option
			},
			{
				singlePerResource: true,
				canSupportResource: (resource: URI) => {
					// Support both file:// and untitled:// schemes
					return resource.scheme === Schemas.file || resource.scheme === Schemas.untitled;
				}
			},
			{
				createEditorInput: async ({ resource, options }) => {
					// Determine notebook type from file content or metadata
					const viewType = await this.detectNotebookViewType(resource);

					// Type guard for backup working copy options
					interface BackupWorkingCopyOptions {
						_backupId?: string;
						_workingCopy?: IWorkingCopyIdentifier;
					}
					function hasBackupWorkingCopyOptions(obj: unknown): obj is BackupWorkingCopyOptions {
						return typeof obj === 'object' && obj !== null &&
							('_backupId' in obj || '_workingCopy' in obj);
					}

					// Preserve backup options if they exist
					const positronOptions: PositronNotebookEditorInputOptions = {
						startDirty: false,
						_backupId: hasBackupWorkingCopyOptions(options) ? options._backupId : undefined,
						_workingCopy: hasBackupWorkingCopyOptions(options) ? options._workingCopy : undefined
					};

					const editorInput = PositronNotebookEditorInput.getOrCreate(
						this.instantiationService,
						resource,
						undefined,
						viewType,
						positronOptions
					);

					return { editor: editorInput, options };
				}
			}
		));
	}

	private async detectNotebookViewType(resource: URI): Promise<string> {
		// Check if there's already an open notebook model for this URI
		const existingModel = this.notebookService.getNotebookTextModel(resource);
		if (existingModel) {
			return existingModel.viewType;
		}

		// Use NotebookService to detect the correct viewType
		const notebookProviders = this.notebookService.getContributedNotebookTypes(resource);

		// Default to jupyter-notebook if detection fails
		return notebookProviders[0]?.id || 'jupyter-notebook';
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
		const viewType = this.getViewType(workingCopy)!;
		return PositronNotebookEditorInput.getOrCreate(
			this.instantiationService,
			workingCopy.resource,
			undefined,
			viewType,
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
		PositronNotebookEditorInput.EditorID,
		localize('positronNotebookEditor', "Positron Notebook Editor")
	),
	[
		new SyncDescriptor(PositronNotebookEditorInput)
	]
);

// Register workbench contributions.
const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchContributionsRegistry.registerWorkbenchContribution(PositronNotebookContribution, LifecyclePhase.Restored);

// Register the working copy handler for backup restoration
registerWorkbenchContribution2(PositronNotebookWorkingCopyEditorHandler.ID, PositronNotebookWorkingCopyEditorHandler, WorkbenchPhase.BlockRestore);



type SerializedPositronNotebookEditorData = { resource: URI; viewType: string; options?: PositronNotebookEditorInputOptions };
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
		if (!data) {
			return undefined;
		}
		const { resource, viewType, options } = data;
		if (!data || !URI.isUri(resource) || typeof viewType !== 'string') {
			return undefined;
		}

		const input = PositronNotebookEditorInput.getOrCreate(instantiationService, resource, undefined, viewType, options);
		return input;
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	PositronNotebookEditorInput.ID,
	PositronNotebookEditorSerializer
);


//#region Keybindings


registerCellCommand({
	commandId: 'positronNotebook.cell.insertCodeCellAboveAndFocusContainer',
	handler: (cell) => cell.insertCodeCellAbove(),
	options: {
		keybinding: {
			primary: KeyCode.KeyA
		}
	},
	metadata: {
		description: localize('positronNotebook.cell.insertAbove', "Insert code cell above")
	}
});

registerCellCommand({
	commandId: 'positronNotebook.cell.insertCodeCellBelowAndFocusContainer',
	handler: (cell) => cell.insertCodeCellBelow(),
	options: {
		keybinding: {
			primary: KeyCode.KeyB
		}
	},
	metadata: {
		description: localize('positronNotebook.cell.insertBelow', "Insert code cell below")
	}
});

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

registerCellCommand({
	commandId: 'positronNotebook.cell.executeAndFocusContainer',
	handler: (cell) => cell.run(),
	options: {
		keybinding: {
			primary: KeyMod.CtrlCmd | KeyCode.Enter
		}
	},
	metadata: {
		description: localize('positronNotebook.cell.execute', "Execute cell")
	}
});

registerCellCommand({
	commandId: 'positronNotebook.cell.executeAndSelectBelow',
	handler: (cell, accessor) => {
		cell.run();
		const notebookService = accessor.get(IPositronNotebookService);
		const notebook = notebookService.getActiveInstance();
		if (notebook) {
			notebook.selectionStateMachine.moveDown(false);
		}
	},
	options: {
		keybinding: {
			primary: KeyMod.Shift | KeyCode.Enter
		}
	},
	metadata: {
		description: localize('positronNotebook.cell.executeAndSelectBelow', "Execute cell and select below")
	}
});


//#endregion Keybindings

//#region Cell Commands
// Register delete command with UI in one call
// For built-in commands, we don't need to manage the disposable since they live
// for the lifetime of the application
registerCellCommand(
	{
		commandId: 'positronNotebook.cell.delete',
		handler: (cell) => cell.delete(),
		options: {
			multiSelect: true,  // Delete all selected cells
			actionBar: {
				icon: 'codicon-trash',
				position: 'main',
				order: 100
			},
			keybinding: {
				primary: KeyCode.Backspace,
				secondary: [KeyChord(KeyCode.KeyD, KeyCode.KeyD)]
			}
		},
		metadata: {
			description: localize('positronNotebook.cell.delete.description', "Delete the selected cell(s)"),
		}
	}
);
//#endregion Cell Commands


