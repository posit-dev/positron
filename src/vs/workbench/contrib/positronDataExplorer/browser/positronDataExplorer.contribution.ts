/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
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
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { PositronDataExplorerEditor } from 'vs/workbench/contrib/positronDataExplorer/browser/positronDataExplorerEditor';
import { IEditorResolverService, RegisteredEditorPriority } from 'vs/workbench/services/editor/common/editorResolverService';
import { registerPositronDataExplorerActions } from 'vs/workbench/contrib/positronDataExplorer/browser/positronDataExplorerActions';
import { PositronDataExplorerEditorInput } from 'vs/workbench/contrib/positronDataExplorer/browser/positronDataExplorerEditorInput';

/**
 * PositronDataExplorerContribution class.
 */
class PositronDataExplorerContribution extends Disposable {
	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this._register(editorResolverService.registerEditor(
			`${Schemas.positronDataExplorer}:**/**`,
			{
				id: PositronDataExplorerEditorInput.EditorID,
				label: localize('positronDataExplorer', "Positron Data Explorer"),
				priority: RegisteredEditorPriority.builtin
			},
			{
				singlePerResource: true,
				canSupportResource: resource => resource.scheme === Schemas.positronDataExplorer
			},
			{
				createEditorInput: ({ resource, options }) => {
					return { editor: instantiationService.createInstance(PositronDataExplorerEditorInput, resource), options };
				}
			}
		));
	}
}

// Register the Positron data explorer editor pane.
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PositronDataExplorerEditor,
		PositronDataExplorerEditorInput.EditorID,
		localize('positronDataExplorerEditor', "Positron Data Explorer Editor")
	),
	[
		new SyncDescriptor(PositronDataExplorerEditorInput)
	]
);

// Register workbench contributions.
const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchContributionsRegistry.registerWorkbenchContribution(PositronDataExplorerContribution, LifecyclePhase.Starting);

// Register actions.
registerPositronDataExplorerActions();
