/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from 'vs/nls';
import { registerAction2 } from 'vs/platform/actions/common/actions';
import { Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { PositronLayoutAction, PositronLayoutInfo } from './layoutAction';

export const positronNotebookLayout: PositronLayoutInfo = {
	id: 'workbench.action.positronNotebookLayout',
	codicon: 'positron-notebook-layout',
	label: localize2('chooseLayout.notebookLayout', 'Notebook Layout'),
	layoutDescriptor: {
		[Parts.PANEL_PART]: {
			size: '40%',
			hidden: true,
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
		[Parts.SIDEBAR_PART]: {
			hidden: false,
			size: '15%',
			minSize: 180,
			hideIfBelowMinSize: true,
		},
		[Parts.AUXILIARYBAR_PART]: {
			hidden: true,
			size: '20%',
			minSize: 180,
		},
	},
};

registerAction2(class extends PositronLayoutAction {
	constructor() {
		super(positronNotebookLayout);
	}
});
