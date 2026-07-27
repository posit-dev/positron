/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorExtensions, IEditorSerializer, IEditorFactoryRegistry } from '../../../common/editor.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { localize, localize2 } from '../../../../nls.js';
import { ServicesAccessor, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { PositronStartupDiagnosticsContrib, PositronStartupDiagnosticsInput, EXTENSION_HOST_TIMEOUT_CONFIG_KEY, EXTENSION_HOST_TIMEOUT_DEFAULT_MS } from './positronStartupDiagnosticsEditor.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { positronConfigurationNodeBase } from '../../../services/languageRuntime/common/languageRuntime.js';

// Register the contribution (lazy loading)
registerWorkbenchContribution2(
	PositronStartupDiagnosticsContrib.ID,
	PositronStartupDiagnosticsContrib,
	WorkbenchPhase.BlockRestore
);

// Register timeout used by the diagnostics report
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	...positronConfigurationNodeBase,
	properties: {
		[EXTENSION_HOST_TIMEOUT_CONFIG_KEY]: {
			type: 'number',
			default: EXTENSION_HOST_TIMEOUT_DEFAULT_MS,
			minimum: 1000,
			maximum: 60000,
			description: localize(
				'positron.startupDiagnostics.timeout',
				"Time in milliseconds the Runtime Startup Diagnostics report will wait for a response from the extension host before continuing without that data. Increase this on slower systems."
			)
		}
	}
});

// Register editor serializer
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	PositronStartupDiagnosticsInput.Id,
	class implements IEditorSerializer {
		canSerialize(): boolean {
			return true;
		}
		serialize(): string {
			return '';
		}
		deserialize(instantiationService: IInstantiationService): PositronStartupDiagnosticsInput {
			return instantiationService.createInstance(PositronStartupDiagnosticsInput);
		}
	}
);

// Register F1 command
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'positron.startupDiagnostics.show',
			title: localize2('positronStartupDiagnostics.title', 'Runtime Startup Diagnostics'),
			category: Categories.Developer,
			f1: true,
			metadata: {
				description: localize('positron.startupDiagnostics.show.description', "Open the runtime startup diagnostics editor to inspect interpreter discovery output."),
				agentCompatible: true,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const contrib = PositronStartupDiagnosticsContrib.get();
		// Do not return the IEditorPane: this command is agent-compatible, and the
		// result is marshalled across the extension host RPC boundary. A live editor
		// pane is not serializable, so returning it makes the Assistant see a failure
		// even though the editor opened. Await (surfacing any error) and return void.
		await editorService.openEditor(contrib.getEditorInput(), { pinned: true });
	}
});
