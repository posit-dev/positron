/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../nls.js';
import { registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { Parts } from '../../../layout/browser/layoutService.js';
import { PositronLayoutAction, PositronLayoutInfo } from './layoutAction.js';
import { LayoutViewContainers } from './layoutViewContainers.js';

/**
 * The layout for working in scripts and Quarto documents: files on the left,
 * the editor in the middle, and the console, variables, plots, and terminal
 * stacked on the right. New windows start in it.
 *
 * Its command id still says two pane, from when it was the Side by Side layout,
 * so existing keybindings keep working.
 */
export const positronTwoPaneLayout: PositronLayoutInfo = {
	id: 'workbench.action.positronTwoPaneDataScienceLayout',
	codicon: 'positron-two-pane-ds-layout',
	label: localize2('choseLayout.dataAnalysis', 'Data Analysis Layout'),
	taskLayout: {
		name: localize('positron.taskLayout.dataAnalysis', "Data Analysis"),
		description: localize('positron.taskLayout.dataAnalysisDescription', "Scripts, console, variables, and plots"),
		group: 'task',
		order: 0,
		hiddenViewContainers: [
			...LayoutViewContainers.gitHub,
			...LayoutViewContainers.publisher,
		],
	},
	precondition: ContextKeyExpr.true(),
	agentCompatible: true,
	agentDescription: 'Switch the workbench to the data analysis layout (files, editor, and a wide session panel with the console, variables, plots, and terminal).',
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
			size: '40%',
			hidden: false,
			viewContainers: [
				{
					id: 'workbench.panel.positronSession',
					opened: true,
					views: [
						{
							id: 'workbench.panel.positronConsole',
						},
						{
							id: 'workbench.panel.positronVariables',
						},
						{
							id: 'workbench.panel.positronPlots',
							collapsed: true,
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


registerAction2(class extends PositronLayoutAction {
	constructor() {
		super(positronTwoPaneLayout);
	}
});
