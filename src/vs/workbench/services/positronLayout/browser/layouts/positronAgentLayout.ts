/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../../nls.js';
import { registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { Parts } from '../../../layout/browser/layoutService.js';
import { IPositronLayoutService } from '../interfaces/positronLayoutService.js';
import { PositronLayoutAction, PositronLayoutInfo } from './layoutAction.js';
import { AI_ENABLED_KEY } from '../../../../contrib/positronAssistant/common/positronAIConfigurationKeys.js';


export const positronAgentLayout: PositronLayoutInfo = {
	id: 'workbench.action.positronAgentLayout',
	codicon: 'sparkle',
	label: localize2('choseLayout.agent', 'Agent Layout'),
	// Requires Posit Assistant: the layout opens the Assistant in the editor
	// area via a posit-assistant command, so there is no legacy-chat fallback.
	// Gate on the config values directly (not ChatContextKeys.aiFeaturesEnabled):
	// that context key is only bound once ChatAgentService is instantiated, so
	// it can be absent when the palette or layout picker evaluates this.
	precondition: ContextKeyExpr.and(
		ContextKeyExpr.has(`config.${AI_ENABLED_KEY}`),
		ContextKeyExpr.has('config.assistant.enabled'),
	)!,
	layoutDescriptor: {
		[Parts.PANEL_PART]: {
			hidden: true,
			alignment: 'center'
		},
		[Parts.SIDEBAR_PART]: {
			hidden: true
		},
		[Parts.AUXILIARYBAR_PART]: {
			hidden: false,
			size: '30%',
			viewContainers: [
				{
					id: 'workbench.panel.positronSession',
					opened: true,
					views: [
						{
							// Collapsed on entry; running code pops it open
							id: 'workbench.panel.positronConsole',
							collapsed: true,
						},
						{
							id: 'workbench.panel.positronVariables',
						},
						{
							id: 'workbench.panel.positronPlots',
						},
					]
				},
				{
					id: 'terminal',
				}
			]
		},
	},
};


registerAction2(class extends PositronLayoutAction {
	constructor() {
		super(positronAgentLayout);
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IPositronLayoutService).setLayout(positronAgentLayout.layoutDescriptor);

		// The layout descriptor only covers the panel, sidebar, and auxiliary
		// bar; the big Assistant pane in the editor area comes from Posit
		// Assistant's own command, which carries over the sidebar conversation
		// if one exists (and activates the extension if needed).
		await accessor.get(ICommandService).executeCommand('posit-assistant.moveToEditorPanel');
	}
});
