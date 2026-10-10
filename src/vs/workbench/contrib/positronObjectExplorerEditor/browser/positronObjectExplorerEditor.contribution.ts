/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { localize } from '../../../../nls.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { PositronActionBarWidgetRegistry } from '../../../../platform/positronActionBar/browser/positronActionBarWidgetRegistry.js';
import { Schemas } from '../../../../base/common/network.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { EditorExtensions } from '../../../common/editor.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { IPositronObjectExplorerService } from '../../../services/positronObjectExplorer/browser/interfaces/positronObjectExplorerService.js';
import { PositronObjectExplorerUri } from '../../../services/positronObjectExplorer/common/positronObjectExplorerUri.js';
import { PositronObjectExplorerEditor } from './positronObjectExplorerEditor.js';
import { PositronObjectExplorerEditorInput } from './positronObjectExplorerEditorInput.js';
import { registerPositronObjectExplorerActions } from './positronObjectExplorerActions.js';
import { ObjectExplorerSearchWidget } from './objectExplorerSearchWidget.js';
import { POSITRON_OBJECT_EXPLORER_IS_ACTIVE_EDITOR } from './positronObjectExplorerContextKeys.js';

/**
 * PositronObjectExplorerContribution class.
 */
class PositronObjectExplorerContribution extends Disposable {
	static readonly ID = 'workbench.contrib.positronObjectExplorer';

	/**
	 * Constructor. Depends on the object explorer service so that it starts with the workbench and
	 * sees every object explorer comm that runtimes open.
	 */
	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
		@INotificationService notificationService: INotificationService,
		@IPositronObjectExplorerService objectExplorerService: IPositronObjectExplorerService,
	) {
		super();

		this._register(editorResolverService.registerEditor(
			`${Schemas.positronObjectExplorer}:**/**`,
			{
				id: PositronObjectExplorerEditorInput.EditorID,
				label: localize('positron.objectExplorer.editorLabel', "Object Explorer"),
				priority: RegisteredEditorPriority.builtin
			},
			{
				singlePerResource: true,
				canSupportResource: resource => resource.scheme === Schemas.positronObjectExplorer
			},
			{
				createEditorInput: async ({ resource, options }) => {
					// An editor for a JSON file can be opened before the file has been read.
					const fileUri = PositronObjectExplorerUri.backingUri(resource);
					if (fileUri) {
						await objectExplorerService.loadJsonFile(fileUri).catch(err => notificationService.error(err));
					}
					return {
						editor: instantiationService.createInstance(PositronObjectExplorerEditorInput, resource),
						options: { ...options, pinned: true }
					};
				}
			}
		));
	}
}

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PositronObjectExplorerEditor,
		PositronObjectExplorerEditorInput.EditorID,
		localize('positron.objectExplorer.editorPaneLabel', "Object Explorer Editor")
	),
	[new SyncDescriptor(PositronObjectExplorerEditorInput)]
);

registerWorkbenchContribution2(
	PositronObjectExplorerContribution.ID,
	PositronObjectExplorerContribution,
	WorkbenchPhase.BlockRestore
);

registerPositronObjectExplorerActions();

PositronActionBarWidgetRegistry.registerWidget({
	id: 'positronObjectExplorer.search',
	menuId: MenuId.EditorActionsRight,
	order: 0,
	placement: 'before',
	when: POSITRON_OBJECT_EXPLORER_IS_ACTIVE_EDITOR,
	selfContained: true,
	componentFactory: accessor => () => React.createElement(ObjectExplorerSearchWidget, { accessor })
});
