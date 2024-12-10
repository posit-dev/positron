/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../../nls.js';
import { registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { Parts } from '../../../layout/browser/layoutService.js';
import { PositronLayoutAction, PositronLayoutInfo } from './layoutAction.js';

// Layout that puts the help pane in the auxiliary bar under the sessions tab. Used for testing the
// help pane collapse and open logic.

export const positronHelpPaneDocked: PositronLayoutInfo = {
	id: 'workbench.action.positronHelpPaneDocked',
	label: localize2('choseLayout.positronHelpPane', 'Docked Help Pane Layout'),
	hideFromPalette: false,
	layoutDescriptor: {
		[Parts.PANEL_PART]: { hidden: true },
		[Parts.SIDEBAR_PART]: { hidden: true },
		[Parts.AUXILIARYBAR_PART]: {
			hidden: false,
			size: '60%',
			viewContainers: [
				{
					id: 'workbench.panel.positronSession',
					opened: true,
					views: [
						{
							id: 'workbench.panel.positronConsole',
						},
						{
							id: 'workbench.panel.positronHelp',
							collapsed: true,
						},
					]
				}
			]
		},
	},
};


registerAction2(class extends PositronLayoutAction {
	constructor() {
		super(positronHelpPaneDocked);
	}
});

