/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../nls.js';
import { registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { Parts } from '../../../layout/browser/layoutService.js';
import { PositronLayoutAction, PositronLayoutInfo } from './layoutAction.js';
import { LayoutViewContainers } from './layoutViewContainers.js';

/**
 * The layout for building apps, such as Shiny or Streamlit apps. The running
 * app is the output to watch, so the Viewer gets a wide tab on the right, with
 * the console and terminal for server logs in the Session tab next to it.
 * Source Control and Posit Publisher stay, since publishing is the last step.
 *
 * The Viewer only shows once an app or other content is in it, so the layout
 * opens on the Session tab, and running an app switches to the Viewer.
 */
export const positronAppDevelopmentLayout: PositronLayoutInfo = {
	id: 'workbench.action.positronAppDevelopmentLayout',
	codicon: 'browser',
	label: localize2('choseLayout.appDevelopment', 'App Development Layout'),
	taskLayout: {
		name: localize('positron.taskLayout.appDevelopment', "App Development"),
		description: localize('positron.taskLayout.appDevelopmentDescription', "Your app running in the Viewer"),
		group: 'task',
		order: 2,
		hiddenViewContainers: [
			...LayoutViewContainers.dataConnections,
		],
	},
	precondition: ContextKeyExpr.true(),
	agentCompatible: true,
	agentDescription: 'Switch the workbench to the app development layout (files, editor, and a wide Viewer for the running app, with the console and terminal next to it).',
	layoutDescriptor: {
		[Parts.SIDEBAR_PART]: {
			size: '15%',
			hidden: false,
			hideIfBelowMinSize: true,
			viewContainers: [
				{
					id: 'workbench.view.explorer',
					opened: true,
				},
			]
		},
		[Parts.PANEL_PART]: {
			hidden: true,
			closeWhenHidden: true,
			alignment: 'center',
		},
		[Parts.AUXILIARYBAR_PART]: {
			size: '45%',
			hidden: false,
			viewContainers: [
				{
					id: 'workbench.panel.positronPreview',
				},
				{
					id: 'workbench.panel.positronSession',
					opened: true,
					views: [
						{
							id: 'workbench.panel.positronConsole',
						},
						{
							id: 'terminal',
						},
						{
							id: 'workbench.panel.positronVariables',
							collapsed: true,
						},
						{
							id: 'workbench.panel.positronPlots',
							collapsed: true,
						},
					]
				},
			]
		},
	},
};


registerAction2(class extends PositronLayoutAction {
	constructor() {
		super(positronAppDevelopmentLayout);
	}
});
