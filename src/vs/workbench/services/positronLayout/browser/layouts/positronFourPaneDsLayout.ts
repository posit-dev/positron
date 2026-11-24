/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../nls.js';
import { registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { Parts } from '../../../layout/browser/layoutService.js';
import { PositronLayoutAction, PositronLayoutInfo } from './layoutAction.js';


/**
 * Positron's standard layout: files on the left, the console and terminal under
 * the editor, and variables and plots on the right. In the simplified layout it
 * is the one layout that shows every view where it normally lives, as Positron
 * does with the simplified layout off.
 *
 * Its command id still says four pane, from when it was the Stacked layout, so
 * existing keybindings keep working.
 */
export const positronFourPaneDsLayout: PositronLayoutInfo = {
	id: 'workbench.action.positronFourPaneDataScienceLayout',
	codicon: 'positron-four-pane-ds-layout',
	label: localize2('choseLayout.default', 'Default Layout'),
	taskLayout: {
		name: localize('positron.taskLayout.default', "Default"),
		description: localize('positron.taskLayout.defaultDescription', "Every view, where it normally lives"),
		group: 'layout',
		order: 0,
	},
	precondition: ContextKeyExpr.true(),
	agentCompatible: true,
	agentDescription: 'Switch the workbench to the default four-pane layout (explorer, editor, console + terminal, variables + plots).',
	layoutDescriptor: {
		[Parts.SIDEBAR_PART]: {
			size: '15%',
			hidden: false,
			viewContainers: [
				{
					id: 'workbench.view.explorer',
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
		super(positronFourPaneDsLayout);
	}
});
