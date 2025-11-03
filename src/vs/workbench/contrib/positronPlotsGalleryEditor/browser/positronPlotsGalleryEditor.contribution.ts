/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { localize } from '../../../../nls.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { EditorExtensions } from '../../../common/editor.js';
import { PositronPlotsGalleryEditor } from './positronPlotsGalleryEditor.js';
import { PositronPlotsGalleryEditorInput } from './positronPlotsGalleryEditorInput.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';

/**
 * Contribution that registers the Positron Plots Gallery editor.
 */
class PositronPlotsGalleryEditorContribution extends Disposable {
	static readonly ID = 'workbench.contrib.positronPlotsGalleryEditor';

	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();

		// Register the editor resolver
		this._register(editorResolverService.registerEditor(
			`${Schemas.positronPlotsGallery}:**/**`,
			{
				id: PositronPlotsGalleryEditorInput.EditorID,
				label: localize('positronPlotsGalleryEditor', 'Plots Gallery'),
				priority: RegisteredEditorPriority.builtin
			},
			{
				singlePerResource: false, // Allow multiple instances
				canSupportResource: resource => resource.scheme === Schemas.positronPlotsGallery
			},
			{
				createEditorInput: ({ resource, options }) => {
					return {
						editor: instantiationService.createInstance(
							PositronPlotsGalleryEditorInput
						),
						options: {
							...options,
							// Always pin the editor
							pinned: true
						}
					};
				}
			}
		));
	}
}

// Register the editor pane
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PositronPlotsGalleryEditor,
		PositronPlotsGalleryEditorInput.EditorID,
		'Plots Gallery',
	),
	[
		new SyncDescriptor(PositronPlotsGalleryEditorInput)
	]
);

// Register the contribution
registerWorkbenchContribution2(
	PositronPlotsGalleryEditorContribution.ID,
	PositronPlotsGalleryEditorContribution,
	WorkbenchPhase.AfterRestored
);

// Context key for when the plots gallery editor is active
export const PLOTS_GALLERY_IS_ACTIVE_EDITOR = ContextKeyExpr.equals('activeEditor', PositronPlotsGalleryEditorInput.EditorID);
