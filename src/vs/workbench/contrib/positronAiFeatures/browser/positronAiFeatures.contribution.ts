/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize2 } from '../../../../nls.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../platform/configuration/common/configurationRegistry.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IUntitledTextResourceEditorInput } from '../../../common/editor.js';
import { AgentAllowedCommandsService, IAgentAllowedCommandsService } from '../common/agentAllowedCommandsService.js';

registerSingleton(IAgentAllowedCommandsService, AgentAllowedCommandsService, InstantiationType.Delayed);

// The Posit Assistant extension ships `assistant.positronCommandIntegration` off by
// default; Positron turns it on so the assistant can run IDE commands out of the box.
// Users can still opt out per user/workspace.
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerDefaultConfigurations([{ overrides: { 'assistant.positronCommandIntegration': true } }]);

registerAction2(class ShowAgentAllowedCommandsAction extends Action2 {
	constructor() {
		super({
			id: 'positron.ai.showAgentAllowedCommands',
			title: localize2('positron.ai.showAgentAllowedCommands', 'Show Agent-Allowed Commands'),
			category: Categories.Developer,
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const commands = accessor.get(IAgentAllowedCommandsService).getAllAgentCompatibleCommands();
		await accessor.get(IEditorService).openEditor({
			resource: undefined,
			contents: JSON.stringify(commands, null, 2),
			languageId: 'json',
		} satisfies IUntitledTextResourceEditorInput);
	}
});
