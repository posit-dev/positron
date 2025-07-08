/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from '../../../common/contributions.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';

import { parse } from '../../../../base/common/marshalling.js';
import { assertType } from '../../../../base/common/types.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { PositronNotebookEditor } from './PositronNotebookEditor.js';
import { PositronNotebookEditorInput, PositronNotebookEditorInputOptions } from './PositronNotebookEditorInput.js';
import { positronConfigurationNodeBase } from '../../../services/languageRuntime/common/languageRuntime.js';
import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ICommandAndKeybindingRule, KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { POSITRON_NOTEBOOK_EDITOR_FOCUSED } from '../../../services/positronNotebook/browser/ContextKeysManager.js';
import { IPositronNotebookService } from '../../../services/positronNotebook/browser/positronNotebookService.js';
import { IPositronNotebookInstance } from '../../../services/positronNotebook/browser/IPositronNotebookInstance.js';

// Configuration constants
export const POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY = 'positron.notebooks.defaultEditor';
const LEGACY_CONFIG_KEY = 'positron.notebooks.usePositronNotebooksExperimental';

// Register the new configuration
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	...positronConfigurationNodeBase,
	scope: ConfigurationScope.MACHINE_OVERRIDABLE,
	properties: {
		[POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY]: {
			type: 'string',
			enum: ['positron', 'vscode'],
			enumDescriptions: [
				localize('positron.notebooks.defaultEditor.positron', 'Use Positron\'s notebook editor for .ipynb files'),
				localize('positron.notebooks.defaultEditor.vscode', 'Use VS Code\'s built-in notebook editor for .ipynb files')
			],
			default: 'vscode',
			markdownDescription: localize(
				'positron.notebooks.defaultEditor.description',
				'Choose which editor to use for notebook (.ipynb) files. You can always use "Open With..." to override this setting for specific files.'
			),
			scope: ConfigurationScope.MACHINE_OVERRIDABLE
		}
	}
});

/**
 * Get the user's preferred notebook editor
 * @param configurationService Configuration service
 * @returns 'positron' | 'vscode'
 */
export function getPreferredNotebookEditor(configurationService: IConfigurationService): 'positron' | 'vscode' {
	const value = configurationService.getValue<'positron' | 'vscode'>(POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY) || 'vscode';
	return value === 'positron' || value === 'vscode' ? value : 'vscode';
}

/**
 * Handle migration from old experimental setting (log-only approach)
 */
class PositronNotebookConfigMigration implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronNotebookConfigMigration';

	constructor(@IConfigurationService private readonly configurationService: IConfigurationService) {
		this.checkForLegacyConfiguration();
	}

	private checkForLegacyConfiguration(): void {
		const legacyValue = this.configurationService.getValue<boolean>(LEGACY_CONFIG_KEY);
		if (legacyValue === true) {
			console.log(
				'Positron: The setting "positron.notebooks.usePositronNotebooksExperimental" has been replaced. ' +
				'Please use "positron.notebooks.defaultEditor" instead. ' +
				'Set it to "positron" to continue using Positron notebooks as your default.'
			);
		}
	}
}





/**
 * PositronNotebookContribution class.
 */
class PositronNotebookContribution extends Disposable {
	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INotebookService private readonly notebookService: INotebookService
	) {
		super();

		// Register for .ipynb files
		this._register(editorResolverService.registerEditor(
			'*.ipynb',
			{
				id: PositronNotebookEditorInput.EditorID,
				label: localize('positronNotebook', "Positron Notebook"),
				detail: localize('positronNotebook.detail', "Provided by Positron"),
				priority: this.getEditorPriority()
			},
			{
				singlePerResource: true,
				canSupportResource: (resource: URI) => {
					// Only support file:// scheme initially
					return resource.scheme === Schemas.file;
				}
			},
			{
				createEditorInput: async ({ resource, options }) => {
					// Determine notebook type from file content or metadata
					const viewType = await this.detectNotebookViewType(resource);

					const editorInput = PositronNotebookEditorInput.getOrCreate(
						this.instantiationService,
						resource,
						undefined,
						viewType,
						{ startDirty: false }
					);

					return { editor: editorInput, options };
				}
			}
		));

		// Set initial editor associations
		this.updateEditorPriority();

		// Re-register when configuration changes
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY)) {
				this.updateEditorPriority();
			}
		}));
	}

	private getEditorPriority(): RegisteredEditorPriority {
		const defaultEditor = getPreferredNotebookEditor(this.configurationService);
		return defaultEditor === 'positron'
			? RegisteredEditorPriority.default  // Default priority - opens by default
			: RegisteredEditorPriority.option; // Option priority - available in "Open With"
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

	private updateEditorPriority(): void {
		// Manage workbench.editorAssociations to ensure proper notebook editor selection
		const defaultEditor = getPreferredNotebookEditor(this.configurationService);
		const currentAssociations = this.configurationService.getValue<Record<string, string>>('workbench.editorAssociations') || {};

		if (defaultEditor === 'positron') {
			// Add association to ensure Positron opens .ipynb files
			if (currentAssociations['*.ipynb'] !== PositronNotebookEditorInput.EditorID) {
				const newAssociations = {
					...currentAssociations,
					'*.ipynb': PositronNotebookEditorInput.EditorID
				};
				this.configurationService.updateValue('workbench.editorAssociations', newAssociations);
			}
		} else {
			// Remove association to allow VS Code's default behavior
			if (currentAssociations['*.ipynb'] === PositronNotebookEditorInput.EditorID) {
				const newAssociations = { ...currentAssociations };
				delete newAssociations['*.ipynb'];
				this.configurationService.updateValue('workbench.editorAssociations', newAssociations);
			}
		}
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
registerNotebookKeybinding({
	id: 'positronNotebook.cell.insertCodeCellAboveAndFocusContainer',
	primary: KeyCode.KeyA,
	onRun: ({ activeNotebook }) => {
		activeNotebook.insertCodeCellAndFocusContainer('above');
	}
});

registerNotebookKeybinding({
	id: 'positronNotebook.cell.insertCodeCellBelowAndFocusContainer',
	primary: KeyCode.KeyB,
	onRun: ({ activeNotebook }) => {
		activeNotebook.insertCodeCellAndFocusContainer('below');
	}
});

registerNotebookKeybinding({
	id: 'positronNotebook.focusUp',
	primary: KeyCode.UpArrow,
	secondary: [KeyCode.KeyK],
	onRun: ({ activeNotebook }) => {
		activeNotebook.selectionStateMachine.moveUp(false);
	}
});

registerNotebookKeybinding({
	id: 'positronNotebook.focusDown',
	primary: KeyCode.DownArrow,
	secondary: [KeyCode.KeyJ],
	onRun: ({ activeNotebook }) => {
		activeNotebook.selectionStateMachine.moveDown(false);
	}
});

registerNotebookKeybinding({
	id: 'positronNotebook.addSelectionDown',
	primary: KeyMod.Shift | KeyCode.DownArrow,
	secondary: [KeyMod.Shift | KeyCode.KeyJ],
	onRun: ({ activeNotebook }) => {
		activeNotebook.selectionStateMachine.moveDown(true);
	}
});


registerNotebookKeybinding({
	id: 'positronNotebook.addSelectionUp',
	primary: KeyMod.Shift | KeyCode.UpArrow,
	secondary: [KeyMod.Shift | KeyCode.KeyK],
	onRun: ({ activeNotebook }) => {
		activeNotebook.selectionStateMachine.moveUp(true);
	}
});

registerNotebookKeybinding({
	id: 'positronNotebook.cell.delete',
	primary: KeyCode.Backspace,
	secondary: [KeyChord(KeyCode.KeyD, KeyCode.KeyD)],
	onRun: ({ activeNotebook }) => {
		activeNotebook.deleteCell();
	}
});

registerNotebookKeybinding({
	id: 'positronNotebook.cell.executeAndFocusContainer',
	primary: KeyMod.CtrlCmd | KeyCode.Enter,
	onRun: ({ activeNotebook }) => {
		activeNotebook.selectionStateMachine.getSelectedCell()?.run();
	}
});

registerNotebookKeybinding({
	id: 'positronNotebook.cell.executeAndSelectBelow',
	primary: KeyMod.Shift | KeyCode.Enter,
	onRun: ({ activeNotebook }) => {
		const selectedCell = activeNotebook.selectionStateMachine.getSelectedCell();
		if (selectedCell) {
			selectedCell.run();
			activeNotebook.selectionStateMachine.moveDown(false);
		}
	}
});


/**
 * Register a keybinding for the Positron Notebook editor. These are typically used to intercept
 * existing notebook keybindings/commands and run them on positron notebooks instead.
 * @param id The id of the command to run. E.g. 'positronNotebook.focusDown'
 * @param keys The primary keybinding to use.
 * @param macKeys The primary and secondary keybindings to use on macOS.
 * @param onRun A function to run when the keybinding is triggered. Will be called if there is an
 * active notebook instance.
 */
function registerNotebookKeybinding({ id, onRun, ...opts }: {
	id: string;
	onRun: (args: { activeNotebook: IPositronNotebookInstance; accessor: ServicesAccessor }) => void;
} & Pick<ICommandAndKeybindingRule, 'primary' | 'secondary' | 'mac' | 'linux' | 'win'>) {
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: id,
		weight: KeybindingWeight.EditorContrib,
		when: POSITRON_NOTEBOOK_EDITOR_FOCUSED,
		handler: (accessor) => {
			const notebookService = accessor.get(IPositronNotebookService);
			const activeNotebook = notebookService.getActiveInstance();
			if (!activeNotebook) { return; }
			onRun({ activeNotebook, accessor });
		},
		...opts
	});
}
//#endregion Keybindings

// Register the migration
const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(PositronNotebookConfigMigration, LifecyclePhase.Restored);
