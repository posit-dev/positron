/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { Registry } from 'vs/platform/registry/common/platform';
import { EditorPaneDescriptor, IEditorPaneRegistry } from 'vs/workbench/browser/editor';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from 'vs/workbench/common/editor';

import { parse } from 'vs/base/common/marshalling';
import { assertType } from 'vs/base/common/types';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { EditorInput } from 'vs/workbench/common/editor/editorInput';
import { IEditorResolverService, RegisteredEditorPriority } from 'vs/workbench/services/editor/common/editorResolverService';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { PositronNotebookEditor } from './PositronNotebookEditor';
import { PositronNotebookEditorInput, PositronNotebookEditorInputOptions } from './PositronNotebookEditorInput';
import { positronConfigurationNodeBase } from 'vs/workbench/services/languageRuntime/common/languageRuntime';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { POSITRON_NOTEBOOK_EDITOR_FOCUSED } from 'vs/workbench/services/positronNotebook/browser/ContextKeysManager';
import { IPositronNotebookService } from 'vs/workbench/services/positronNotebook/browser/positronNotebookService';
import { IPositronNotebookInstance } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookInstance';



/**
 * Key for the configuration setting that determines whether to use the Positron Notebook editor
 */
const USE_POSITRON_NOTEBOOK_EDITOR_CONFIG_KEY = 'positron.notebooks.usePositronNotebooks';

/**
 * Retrieve the value of the configuration setting that determines whether to use the Positron
 * Notebook editor. Makes sure that the value is a boolean for type-safety.
 * @param configurationService Configuration service
 * @returns A boolean value that determines whether to use the Positron Notebook editor
 */
export function getShouldUsePositronEditor(configurationService: IConfigurationService) {
	return Boolean(configurationService.getValue(USE_POSITRON_NOTEBOOK_EDITOR_CONFIG_KEY));
}

// Register the configuration setting that determines whether to use the Positron Notebook editor
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	...positronConfigurationNodeBase,
	scope: ConfigurationScope.MACHINE_OVERRIDABLE,
	properties: {
		[USE_POSITRON_NOTEBOOK_EDITOR_CONFIG_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize('positron.usePositronNotebooks', "Should the Positron Notebook editor be used instead of the default one?"),
		}
	}
});


/**
 * PositronNotebookContribution class.
 */
class PositronNotebookContribution extends Disposable {
	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this._register(editorResolverService.registerEditor(
			// The glob pattern for this registration
			`${Schemas.positronNotebook}:**/**`,
			// Information about the registration
			{
				id: PositronNotebookEditorInput.EditorID,
				label: localize('positronNotebook', "Positron Notebook"),
				priority: RegisteredEditorPriority.builtin
			},
			// Specific options which apply to this registration
			{
				singlePerResource: true,
				canSupportResource: resource => resource.scheme === Schemas.positronNotebook
			},
			// The editor input factory functions
			{
				// Right now this doesn't do anything because we hijack the
				// vscode built in notebook factories to open our notebooks.
				createEditorInput: ({ resource, options }) => {
					// TODO: Make this be based on the actual file.
					const temporaryViewType = 'jupyter-notebook';
					return { editor: instantiationService.createInstance(PositronNotebookEditorInput, resource, temporaryViewType, {}), options };
				}
			}
		));
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
	id: 'notebook.cell.insertCodeCellAboveAndFocusContainer',
	keys: KeyCode.KeyA,
	onRun: ({ activeNotebook }) => {
		activeNotebook.insertCodeCellAndFocusContainer('above');
	}
});

registerNotebookKeybinding({
	id: 'notebook.cell.insertCodeCellBelowAndFocusContainer',
	keys: KeyCode.KeyB,
	onRun: ({ activeNotebook }) => {
		activeNotebook.insertCodeCellAndFocusContainer('below');
	}
});

registerNotebookKeybinding({
	id: 'list.focusUp',
	keys: KeyCode.UpArrow,
	macKeys: { primary: KeyCode.UpArrow, secondary: [KeyMod.WinCtrl | KeyCode.KeyP] },
	onRun: ({ activeNotebook }) => {
		activeNotebook.selectionStateMachine.moveUp(false);
	}
});

registerNotebookKeybinding({
	id: 'list.focusDown',
	keys: KeyCode.DownArrow,
	macKeys: { primary: KeyCode.DownArrow, secondary: [KeyMod.WinCtrl | KeyCode.KeyN] },
	onRun: ({ activeNotebook }) => {
		activeNotebook.selectionStateMachine.moveDown(false);
	}
});

registerNotebookKeybinding({
	id: 'notebook.cell.delete',
	keys: KeyCode.Backspace,
	onRun: ({ activeNotebook }) => {
		activeNotebook.deleteCell();
	}
});

registerNotebookKeybinding({
	id: 'notebook.cell.executeAndFocusContainer',
	keys: KeyMod.CtrlCmd | KeyCode.Enter,
	onRun: ({ activeNotebook }) => {
		activeNotebook.runCurrentCell(false);
	}
});

registerNotebookKeybinding({
	id: 'notebook.cell.executeAndSelectBelow',
	keys: KeyMod.Shift | KeyCode.Enter,
	onRun: ({ activeNotebook }) => {
		activeNotebook.runCurrentCell(true);
	}
});


/**
 * Register a keybinding for the Positron Notebook editor. These are typically used to intercept
 * existing notebook keybindings/commands and run them on positron notebooks instead.
 * @param id The id of the command to run. E.g. 'list.focusDown'
 * @param keys The primary keybinding to use.
 * @param macKeys The primary and secondary keybindings to use on macOS.
 * @param onRun A function to run when the keybinding is triggered. Will be called if there is an
 * active notebook instance.
 */
function registerNotebookKeybinding({ id, keys, macKeys, onRun }: {
	id: string;
	keys: KeyCode;
	macKeys?: { primary: KeyCode; secondary?: KeyCode[] };
	onRun: (args: { activeNotebook: IPositronNotebookInstance; accessor: ServicesAccessor }) => void;

}) {
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: id,
		weight: KeybindingWeight.WorkbenchContrib,
		when: POSITRON_NOTEBOOK_EDITOR_FOCUSED,
		primary: keys,
		mac: macKeys,
		handler: (accessor) => {
			const notebookService = accessor.get(IPositronNotebookService);
			const activeNotebook = notebookService.getActiveInstance();
			if (!activeNotebook) { return; }
			onRun({ activeNotebook, accessor });
		}
	});
}
//#endregion Keybindings
