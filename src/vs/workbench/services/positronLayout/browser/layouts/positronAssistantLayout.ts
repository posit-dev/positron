/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../nls.js';
import { registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { ViewContainerLocation } from '../../../../common/views.js';
import { IExtensionService } from '../../../extensions/common/extensions.js';
import { IPaneCompositePartService } from '../../../panecomposite/browser/panecomposite.js';
import { Parts } from '../../../layout/browser/layoutService.js';
import { CustomPositronLayoutDescription } from '../../common/positronCustomViews.js';
import { IPositronLayoutService } from '../interfaces/positronLayoutService.js';
import { PositronLayoutAction, PositronLayoutInfo } from './layoutAction.js';
import { LayoutViewContainers } from './layoutViewContainers.js';
import { ChatContextKeys } from '../../../../contrib/chat/common/actions/chatContextKeys.js';
import { AI_ENABLED_KEY } from '../../../../contrib/positronAssistant/common/positronAIConfigurationKeys.js';

const POSIT_ASSISTANT_EXTENSION_ID = 'posit.assistant';

/** Reveals an existing Assistant editor panel, or opens one if none exists. */
const SHOW_EDITOR_PANEL_COMMAND = 'posit-assistant.showEditorPanel';

/**
 * Always opens another Assistant editor panel. Posit Assistant versions
 * before 1.6.0 do not have SHOW_EDITOR_PANEL_COMMAND, so fall back to this.
 */
const MOVE_TO_EDITOR_PANEL_COMMAND = 'posit-assistant.moveToEditorPanel';

/** The older built-in chat, used when Posit Assistant is off. */
const LEGACY_CHAT_VIEW_CONTAINER_ID = 'workbench.panel.chat';

/**
 * The layout for working with an AI assistant. With Posit Assistant on, the
 * chat opens as a large tab in the editor area and the side bar is hidden, so
 * the conversation is the main thing on screen. The console, variables, plots,
 * and terminal sit on the right.
 *
 * With Posit Assistant off, it falls back to the older built-in chat, which can
 * only live in a side bar, so the chat goes in the left side bar instead.
 */
export const positronAssistantLayout: PositronLayoutInfo = {
	id: 'workbench.action.positronAssistantLayout',
	codicon: 'positron-assistant-layout',
	label: localize2('choseLayout.assistant', 'Assistant Layout'),
	taskLayout: {
		name: localize('positron.taskLayout.assistant', "Assistant"),
		description: localize('positron.taskLayout.assistantDescription', "Work alongside an AI assistant"),
		group: 'task',
		order: 3,
		hiddenViewContainers: [
			...LayoutViewContainers.gitHub,
			...LayoutViewContainers.dataConnections,
			...LayoutViewContainers.packages,
			...LayoutViewContainers.publisher,
		],
	},
	// Read Posit Assistant's settings directly as well as the chat context key:
	// the context key is only bound once the chat service starts, so it can be
	// missing when the palette or layout picker checks this.
	precondition: ContextKeyExpr.or(
		ChatContextKeys.aiFeaturesEnabled,
		ContextKeyExpr.and(
			ContextKeyExpr.has(`config.${AI_ENABLED_KEY}`),
			ContextKeyExpr.has('config.assistant.enabled'),
		),
	)!,
	agentCompatible: true,
	agentDescription: 'Switch the workbench to the assistant layout (the assistant chat as the main view, with the console, variables, plots, and terminal on the right).',
	layoutDescriptor: {
		[Parts.PANEL_PART]: {
			hidden: true,
			closeWhenHidden: true,
			alignment: 'center',
		},
		[Parts.SIDEBAR_PART]: {
			hidden: true,
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
							// Collapsed on entry; running code pops it open.
							id: 'workbench.panel.positronConsole',
							collapsed: true,
						},
						{
							id: 'workbench.panel.positronVariables',
						},
						{
							id: 'workbench.panel.positronPlots',
						},
						{
							id: 'terminal',
							collapsed: true,
						},
					]
				},
			]
		},
	},
};

/**
 * The fallback for when Posit Assistant is off: the older built-in chat in the
 * left side bar, next to the editor.
 */
const legacyChatLayoutDescriptor: CustomPositronLayoutDescription = {
	...positronAssistantLayout.layoutDescriptor,
	[Parts.SIDEBAR_PART]: {
		size: '30%',
		hidden: false,
		viewContainers: [{ id: LEGACY_CHAT_VIEW_CONTAINER_ID, opened: true }],
	},
};

registerAction2(class extends PositronLayoutAction {
	constructor() {
		super(positronAssistantLayout);
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);
		const commandService = accessor.get(ICommandService);
		const extensionService = accessor.get(IExtensionService);
		const paneCompositePartService = accessor.get(IPaneCompositePartService);
		const positronLayoutService = accessor.get(IPositronLayoutService);

		const positAssistantOn = configurationService.getValue<boolean>(AI_ENABLED_KEY) === true &&
			configurationService.getValue<boolean>('assistant.enabled') === true;

		if (!positAssistantOn) {
			positronLayoutService.setLayout(legacyChatLayoutDescriptor, positronAssistantLayout.id);
			// The layout opens the side bar container without waiting for it. Wait
			// for an explicit open so the chat is the view that ends up showing.
			await paneCompositePartService.openPaneComposite(LEGACY_CHAT_VIEW_CONTAINER_ID, ViewContainerLocation.Sidebar, true);
			return;
		}

		positronLayoutService.setLayout(positronAssistantLayout.layoutDescriptor, positronAssistantLayout.id);

		// The layout descriptor only covers the panel, side bar, and secondary
		// side bar; the big Assistant tab in the editor area comes from Posit
		// Assistant's own command (which activates the extension if needed).
		// SHOW_EDITOR_PANEL_COMMAND reveals an existing Assistant tab, so picking
		// this layout again does not open a second one. Check the manifest rather
		// than catching a failure, so that a real error from the new command does
		// not also open a second tab.
		const extension = await extensionService.getExtension(POSIT_ASSISTANT_EXTENSION_ID);
		const hasShowEditorPanel = extension?.contributes?.commands?.some(
			command => command.command === SHOW_EDITOR_PANEL_COMMAND
		) === true;
		await commandService.executeCommand(
			hasShowEditorPanel ? SHOW_EDITOR_PANEL_COMMAND : MOVE_TO_EDITOR_PANEL_COMMAND
		);
	}
});
