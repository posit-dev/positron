/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { localize } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { EditorExtensions } from '../../../common/editor.js';
import { PositronPreviewEditor } from './positronPreviewEditor.js';
import { PositronPreviewEditorInput } from './positronPreviewEditorInput.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';

export const POSITRON_EDITOR_PREVIEW = 'application.experimental.positronPreviewEditor';

class PositronPreviewEditorContribution extends Disposable {
	static readonly ID = 'workbench.contrib.positronPreviewEditor';

	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();

		// Register the editor
		this._register(editorResolverService.registerEditor(
			`${Schemas.positronPreviewEditor}:**/**`,
			{
				id: PositronPreviewEditorInput.EditorID,
				label: localize('positronPreivewEditor', 'Editor Preview Tab'),
				priority: RegisteredEditorPriority.builtin
			},
			{
				singlePerResource: true,
				canSupportResource: resource => resource.scheme === Schemas.positronPreviewEditor
			},
			{
				createEditorInput: ({ resource, options }) => {
					return {
						editor: instantiationService.createInstance(
							PositronPreviewEditorInput,
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
		PositronPreviewEditor,
		PositronPreviewEditorInput.EditorID,
		'Editor Preview Tab',
	),
	[
		new SyncDescriptor(PositronPreviewEditorInput)
	]
);

registerWorkbenchContribution2(
	PositronPreviewEditorContribution.ID,
	PositronPreviewEditorContribution,
	WorkbenchPhase.AfterRestored
);

