/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { PositronControlGalleryEditor } from './positronControlGalleryEditor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { PositronControlGalleryEditorInput } from './positronControlGalleryEditorInput.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';

// Side-effect import: each entry self-registers into the control gallery registry.
import './galleries/galleries.js';

/**
 * Serializer that lets the Control Gallery editor survive workbench restart. The input holds
 * no state, so serialization is a marker.
 */
class PositronControlGalleryEditorSerializer implements IEditorSerializer {
	canSerialize(): boolean {
		return true;
	}

	serialize(input: EditorInput): string | undefined {
		if (!(input instanceof PositronControlGalleryEditorInput)) {
			return undefined;
		}
		return JSON.stringify({ existed: true });
	}

	deserialize(instantiationService: IInstantiationService, _serialized: string): EditorInput | undefined {
		return instantiationService.createInstance(PositronControlGalleryEditorInput);
	}
}

/**
 * Developer action that opens (or focuses) the Control Gallery editor. Hidden behind the
 * Developer category -- not surfaced in menus, but discoverable via the command palette.
 */
class OpenPositronControlGalleryAction extends Action2 {
	static readonly ID = 'positron.controlGallery.open';

	constructor() {
		super({
			id: OpenPositronControlGalleryAction.ID,
			title: localize2('positronControlGallery.open', "Open Control Gallery"),
			category: Categories.Developer,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		await editorService.openEditor(
			instantiationService.createInstance(PositronControlGalleryEditorInput),
			{ pinned: true }
		);
	}
}

// Register the editor serializer.
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	PositronControlGalleryEditorInput.TypeID,
	PositronControlGalleryEditorSerializer
);

// Register the editor pane.
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PositronControlGalleryEditor,
		PositronControlGalleryEditorInput.EditorID,
		'Control Gallery',
	),
	[
		new SyncDescriptor(PositronControlGalleryEditorInput)
	]
);

// Register the action that opens the editor.
registerAction2(OpenPositronControlGalleryAction);
