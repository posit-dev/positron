/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../../nls.js';
import { registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { Parts } from '../../../layout/browser/layoutService.js';
import { PositronLayoutAction, PositronLayoutInfo } from './layoutAction.js';


export const positronTwoPaneLayout: PositronLayoutInfo = {
	id: 'workbench.action.positronTwoPaneDataScienceLayout',
	codicon: 'positron-two-pane-ds-layout',
	label: localize2('choseLayout.sideBySide', 'Side-By-Side Layout'),
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
			size: '40%',
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
							collapsed: true,
						},
						{
							id: 'workbench.panel.positronPlots',
							collapsed: true,
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
		super(positronTwoPaneLayout);
	}
});
