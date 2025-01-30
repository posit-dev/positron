/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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
import { PositronPlotsEditor } from './positronPlotsEditor.js';
import { PositronPlotsEditorInput } from './positronPlotsEditorInput.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';

export const POSITRON_EDITOR_PLOTS = 'application.experimental.positronPlotsInEditorTab';

class PositronPlotsEditorContribution extends Disposable {
	static readonly ID = 'workbench.contrib.positronPlotsEditor';

	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();

		// Register the editor
		this._register(editorResolverService.registerEditor(
			`${Schemas.positronPlotsEditor}:**/**`,
			{
				id: PositronPlotsEditorInput.EditorID,
				label: localize('positronPlotsEditor', 'Editor Plot Tab'),
				priority: RegisteredEditorPriority.builtin
			},
			{
				singlePerResource: true,
				canSupportResource: resource => resource.scheme === Schemas.positronPlotsEditor
			},
			{
				createEditorInput: ({ resource, options }) => {
					return {
						editor: instantiationService.createInstance(
							PositronPlotsEditorInput,
							resource
						),
						options: {
							...options,
							// open as a regular editor instead of a preview
							pinned: true
						}
					};
				}
			}
		));
	}
}

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PositronPlotsEditor,
		PositronPlotsEditorInput.EditorID,
		'Editor Plot Tab',
	),
	[
		new SyncDescriptor(PositronPlotsEditorInput)
	]
);

registerWorkbenchContribution2(
	PositronPlotsEditorContribution.ID,
	PositronPlotsEditorContribution,
	WorkbenchPhase.AfterRestored
);

export const PLOT_IS_ACTIVE_EDITOR = ContextKeyExpr.equals('activeEditor', PositronPlotsEditorInput.EditorID);
