/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Schemas } from 'vs/base/common/network';
import { Disposable } from 'vs/base/common/lifecycle';
import { EditorExtensions } from 'vs/workbench/common/editor';
import { Registry } from 'vs/platform/registry/common/platform';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { EditorPaneDescriptor, IEditorPaneRegistry } from 'vs/workbench/browser/editor';
import { PositronDataToolEditor } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolEditor';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { registerPositronDataToolActions } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolActions';
import { PositronDataToolEditorInput } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolEditorInput';
import { IEditorResolverService, RegisteredEditorPriority } from 'vs/workbench/services/editor/common/editorResolverService';

/**
 * PositronDataToolContribution class.
 */
class PositronDataToolContribution extends Disposable {
	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this._register(editorResolverService.registerEditor(
			`${Schemas.positronDataTool}:**/**`,
			{
				id: PositronDataToolEditorInput.EditorID,
				label: localize('positronDataTool', "Positron Data Tool"),
				priority: RegisteredEditorPriority.builtin
			},
			{
				singlePerResource: true,
				canSupportResource: resource => resource.scheme === Schemas.positronDataTool
			},
			{
				createEditorInput: ({ resource, options }) => {
					return { editor: instantiationService.createInstance(PositronDataToolEditorInput, resource), options };
				}
			}
		));
	}
}

// Register the Positron data tool editor pane.
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PositronDataToolEditor,
		PositronDataToolEditorInput.EditorID,
		localize('positronDataToolEditor', "Positron Data Tool Editor")
	),
	[
		new SyncDescriptor(PositronDataToolEditorInput)
	]
);

// Register workbench contributions.
const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchContributionsRegistry.registerWorkbenchContribution(PositronDataToolContribution, LifecyclePhase.Starting);

// Register actions.
registerPositronDataToolActions();
