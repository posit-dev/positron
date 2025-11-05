/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../../nls.js';
import { registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { Parts } from '../../../layout/browser/layoutService.js';
import { PositronLayoutAction, PositronLayoutInfo } from './layoutAction.js';


export const positronFourPaneDsLayout: PositronLayoutInfo = {
	id: 'workbench.action.positronFourPaneDataScienceLayout',
	codicon: 'positron-four-pane-ds-layout',
	label: localize2('choseLayout.stacked', 'Stacked Layout'),
	precondition: ContextKeyExpr.true(),
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
