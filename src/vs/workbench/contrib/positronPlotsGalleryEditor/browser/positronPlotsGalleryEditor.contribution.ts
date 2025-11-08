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
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
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
				singlePerResource: true,
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

/**
 * Serializer for the Positron Plots Gallery editor.
 * Enables better behavior when restoring the editor state.
 */
class PositronPlotsGalleryEditorSerializer implements IEditorSerializer {
	/**
	 * Determines if this editor input can be serialized at all.
	 */
	canSerialize(): boolean {
		return true;
	}

	/**
	 * Serializes the editor input.
	 * We store minimal data - just a marker that this editor existed.
	 */
	serialize(input: EditorInput): string | undefined {
		if (!(input instanceof PositronPlotsGalleryEditorInput)) {
			return undefined;
		}

		// Minimal serialization - just indicate this editor existed
		return JSON.stringify({ existed: true });
	}

	/**
	 * Deserializes the editor input.
	 * Recreates the plots gallery editor when restoring from saved state.
	 */
	deserialize(instantiationService: IInstantiationService, serialized: string): EditorInput | undefined {
		// Recreate the editor input
		return instantiationService.createInstance(PositronPlotsGalleryEditorInput);
	}
}

// Register the editor serializer
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	PositronPlotsGalleryEditorInput.TypeID,
	PositronPlotsGalleryEditorSerializer
);

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
