/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { EditorExtensions } from 'vs/workbench/common/editor';
import { Registry } from 'vs/platform/registry/common/platform';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { EditorPaneDescriptor, IEditorPaneRegistry } from 'vs/workbench/browser/editor';
import { PositronDataToolInput } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolInput';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { PositronDataToolEditor } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolEditor';
import { IEditorResolverService, RegisteredEditorPriority } from 'vs/workbench/services/editor/common/editorResolverService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { URI } from 'vs/base/common/uri';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PositronDataToolEditor,
		PositronDataToolEditor.ID,
		'Positron Data Tool Editor'
	),
	[
		new SyncDescriptor(PositronDataToolInput)
	]
);

/**
 * Positron data tool command ID's.
 */
const enum PositronDataToolCommandId {
	TestAction = 'workbench.action.positronDataTool.TestAction',
}

/**
 * Positron data tool action category.
 */
const POSITRON_DATA_TOOL_ACTION_CATEGORY = localize('positronDataToolCategory', "Data Tool");

/**
 * The category for the actions below.
 */
const category: ILocalizedString = {
	value: POSITRON_DATA_TOOL_ACTION_CATEGORY,
	original: 'CONSOLE'
};

/**
 * Register the clear console action. This action removes everything from the active console,
 * just like running the clear command in a shell.
 */
registerAction2(class extends Action2 {
	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronDataToolCommandId.TestAction,
			title: {
				value: localize('workbench.action.positronDataTool.testAction', "Test Action"),
				original: 'Test Action'
			},
			f1: true,
			category,
			// precondition: PositronConsoleFocused,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.WinCtrl | KeyCode.KeyA
			},
		});
	}

	/**
	 * Runs action.
	 * @param accessor The services accessor.
	 */
	async run(accessor: ServicesAccessor) {
		const instantiationService = accessor.get(IInstantiationService);
		// const editorGroupsService = accessor.get(IEditorGroupsService);
		const editorService = accessor.get(IEditorService);

		const handle = Math.floor(Math.random() * 1e9);

		const fd = URI.from({ scheme: Schemas.positronDataTool, path: `chat-${handle}` });


		const d = await editorService.openEditor({ resource: fd });

		if (d) {
			console.log(`Title is ${d.getTitle()}`);
		}

		instantiationService.createInstance(PositronDataToolEditor);

		console.log('+++++++++++++++ HERE!');
	}
});

class PositronDataToolContribution extends Disposable {
	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this._register(editorResolverService.registerEditor(
			`${Schemas.positronDataTool}:**/**`,
			{
				id: PositronDataToolInput.ID,
				label: localize('positronDataTool', "Positron Data Tool"),
				priority: RegisteredEditorPriority.builtin
			},
			{
				singlePerResource: false,
				canSupportResource: resource => resource.scheme === Schemas.positronDataTool
			},
			{
				createEditorInput: ({ resource, options }) => {
					console.log(`+++++++++++++++++++++++++ resource is ${resource}`);
					return { editor: instantiationService.createInstance(PositronDataToolInput, resource), options };
				}
			}
		));
	}
}

const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchContributionsRegistry.registerWorkbenchContribution(PositronDataToolContribution, LifecyclePhase.Starting);
