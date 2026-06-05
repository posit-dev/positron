/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../../nls.js';
import { registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { ViewContainerLocation } from '../../../../common/views.js';
import { IPaneCompositePartService } from '../../../panecomposite/browser/panecomposite.js';
import { Parts } from '../../../layout/browser/layoutService.js';
import { CustomPositronLayoutDescription } from '../../common/positronCustomViews.js';
import { IPositronLayoutService } from '../interfaces/positronLayoutService.js';
import { PositronLayoutAction, PositronLayoutInfo } from './layoutAction.js';


export const positronAssistantLayout: PositronLayoutInfo = {
	id: 'workbench.action.positronAssistantLayout',
	codicon: 'positron-assistant-layout',
	label: localize2('choseLayout.assistant', 'Assistant Layout'),
	precondition: ContextKeyExpr.or(
		ContextKeyExpr.has('config.positron.assistant.enable'),
		ContextKeyExpr.has('config.assistant.enabled'),
	)!,
	layoutDescriptor: {
		[Parts.SIDEBAR_PART]: {
			size: '30%',
			hidden: false,
			viewContainers: [
				{
					id: 'workbench.panel.chat',
					opened: true,
				},
			]
		},
		[Parts.PANEL_PART]: {
			size: '40%',
			hidden: false,
			alignment: 'center',
			viewContainers: [
				{
					id: 'workbench.panel.positronConsole',
					opened: true,
				},
				{
					id: 'terminal',
				},
			]
		},
		[Parts.AUXILIARYBAR_PART]: {
			size: '30%',
			hidden: false,
			viewContainers: [
				{
					id: 'workbench.panel.positronSession',
					opened: true,
					views: [
						{
							id: 'workbench.panel.positronVariables',
						},
						{
							id: 'workbench.panel.positronPlots',
						},
					]
				},
			]
		}
	},
};


registerAction2(class extends PositronLayoutAction {
	constructor() {
		super(positronAssistantLayout);
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		// Prefer Posit Assistant when enabled; fall back to the legacy Positron Assistant chat view container.
		const configurationService = accessor.get(IConfigurationService);
		const sidebarContainerId = configurationService.getValue<boolean>('assistant.enabled')
			? 'workbench.view.extension.posit-assistant'
			: 'workbench.panel.chat';

		const layoutDescriptor: CustomPositronLayoutDescription = {
			...positronAssistantLayout.layoutDescriptor,
			[Parts.SIDEBAR_PART]: {
				...positronAssistantLayout.layoutDescriptor[Parts.SIDEBAR_PART],
				viewContainers: [{ id: sidebarContainerId, opened: true }],
			},
		};

		accessor.get(IPositronLayoutService).setLayout(layoutDescriptor);

		// The layout opens the sidebar container fire-and-forget; for an
		// extension-contributed, webview-backed composite (Posit Assistant) that
		// open can lose a race with the surrounding layout work on web and leave
		// the sidebar on the previously active view. Await an explicit open so the
		// correct view is reliably revealed and focused on every platform.
		await accessor.get(IPaneCompositePartService).openPaneComposite(sidebarContainerId, ViewContainerLocation.Sidebar, true);
	}
});
