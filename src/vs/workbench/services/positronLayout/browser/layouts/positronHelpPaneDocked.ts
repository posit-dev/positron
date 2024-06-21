/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from 'vs/nls';
import { registerAction2 } from 'vs/platform/actions/common/actions';
import { Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { PositronLayoutAction, PositronLayoutInfo } from './layoutAction';

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

