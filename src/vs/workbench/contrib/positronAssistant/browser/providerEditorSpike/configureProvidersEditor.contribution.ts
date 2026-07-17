/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// SPIKE (#14695): registers the PoC provider-configuration editor and a Developer command to open
// it. Because the input has EditorInputCapabilities.RequiresModal, openEditor routes it to the
// upstream modal editor part (a centered overlay) unless `workbench.editor.useModal: 'off'`, in
// which case it opens as a normal editor tab. Try both to see the dual-host behavior.

import { localize2 } from '../../../../../nls.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { ConfigureProvidersEditor } from './configureProvidersEditor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../browser/editor.js';
import { Categories } from '../../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { ConfigureProvidersEditorInput } from './configureProvidersEditorInput.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../../common/editor.js';
import { IInstantiationService, ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';

class ConfigureProvidersEditorSerializer implements IEditorSerializer {
	canSerialize(): boolean {
		return true;
	}

	serialize(input: EditorInput): string | undefined {
		if (!(input instanceof ConfigureProvidersEditorInput)) {
			return undefined;
		}
		return JSON.stringify({ existed: true });
	}

	deserialize(instantiationService: IInstantiationService, _serialized: string): EditorInput | undefined {
		return instantiationService.createInstance(ConfigureProvidersEditorInput);
	}
}

class OpenConfigureProvidersEditorAction extends Action2 {
	static readonly ID = 'positron.assistant.spike.openProviderEditor';

	constructor() {
		super({
			id: OpenConfigureProvidersEditorAction.ID,
			title: localize2('positron.assistant.spike.openProviderEditor', "Spike: Open Provider Editor"),
			category: Categories.Developer,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		await editorService.openEditor(
			instantiationService.createInstance(ConfigureProvidersEditorInput),
			{ pinned: true }
		);
	}
}

// Register the editor serializer (so the modal survives window reload).
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	ConfigureProvidersEditorInput.TypeID,
	ConfigureProvidersEditorSerializer
);

// Register the editor pane.
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		ConfigureProvidersEditor,
		ConfigureProvidersEditorInput.EditorID,
		'Configure LLM Providers',
	),
	[
		new SyncDescriptor(ConfigureProvidersEditorInput)
	]
);

// Register the action that opens the editor.
registerAction2(OpenConfigureProvidersEditorAction);
