/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { localize } from 'vs/nls';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Registry } from 'vs/platform/registry/common/platform';
import { EditorPaneDescriptor, IEditorPaneRegistry } from 'vs/workbench/browser/editor';
import { registerWorkbenchContribution2, WorkbenchPhase } from 'vs/workbench/common/contributions';
import { EditorExtensions } from 'vs/workbench/common/editor';
import { PositronPreviewEditor } from 'vs/workbench/contrib/positronPreviewEditor/browser/positronPreviewEditor';
import { PositronPreviewEditorInput } from 'vs/workbench/contrib/positronPreviewEditor/browser/positronPreviewEditorInput';
import { IEditorResolverService, RegisteredEditorPriority } from 'vs/workbench/services/editor/common/editorResolverService';

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

