/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Schemas } from 'vs/base/common/network';
import { Disposable } from 'vs/base/common/lifecycle';
import { EditorExtensions } from 'vs/workbench/common/editor';
import { Registry } from 'vs/platform/registry/common/platform';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { EditorPaneDescriptor, IEditorPaneRegistry } from 'vs/workbench/browser/editor';
import { WorkbenchPhase, registerWorkbenchContribution2 } from 'vs/workbench/common/contributions';
import { IEditorResolverService, RegisteredEditorPriority } from 'vs/workbench/services/editor/common/editorResolverService';
import { PositronDataExplorerEditor } from 'vs/workbench/contrib/positronDataExplorerEditor/browser/positronDataExplorerEditor';
import { PositronDataExplorerEditorInput } from 'vs/workbench/contrib/positronDataExplorerEditor/browser/positronDataExplorerEditorInput';
import { registerPositronDataExplorerActions } from 'vs/workbench/contrib/positronDataExplorerEditor/browser/positronDataExplorerActions';

/**
 * PositronDataExplorerContribution class.
 */
class PositronDataExplorerContribution extends Disposable {
	/**
	 * The identifier.
	 */
	static readonly ID = 'workbench.contrib.positronDataExplorer';

	/**
	 * Constructor.
	 * @param editorResolverService The editor resolver service.
	 * @param instantiationService The instantiation service.
	 */
	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		// Call the base class's constructor.
		super();

		// Register the editor.
		this._register(editorResolverService.registerEditor(
			`${Schemas.positronDataExplorer}:**/**`,
			{
				id: PositronDataExplorerEditorInput.EditorID,
				// Label will be overwritten elsewhere
				label: localize('positronDataExplorer', "Positron Data Explorer"),
				priority: RegisteredEditorPriority.builtin
			},
			{
				singlePerResource: true,
				canSupportResource: resource => resource.scheme === Schemas.positronDataExplorer
			},
			{
				createEditorInput: ({ resource, options }) => {
					return {
						editor: instantiationService.createInstance(
							PositronDataExplorerEditorInput,
							resource
						),
						options
					};
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

// Register workbench contribution.
registerWorkbenchContribution2(
	PositronDataExplorerContribution.ID,
	PositronDataExplorerContribution,
	WorkbenchPhase.BlockRestore
);

// Register actions.
registerPositronDataExplorerActions();
