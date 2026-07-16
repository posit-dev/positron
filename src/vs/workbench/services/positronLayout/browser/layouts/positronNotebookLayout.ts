/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../../nls.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { Parts } from '../../../layout/browser/layoutService.js';
import { IPositronLayoutService } from '../interfaces/positronLayoutService.js';
import { PositronLayoutAction, PositronLayoutInfo } from './layoutAction.js';

export const positronNotebookLayout: PositronLayoutInfo = {
	id: 'workbench.action.positronNotebookLayout',
	codicon: 'positron-notebook-layout',
	label: localize2('chooseLayout.notebookLayout', 'Notebook Layout'),
	precondition: ContextKeyExpr.true(),
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
			size: '20%',
			hidden: false,
			viewContainers: [
				{
					id: 'workbench.panel.positronSession',
					opened: true,
					views: [
						{
							id: 'workbench.panel.positronVariables',
						},
					]
				},
			]
		}
	},
};

registerAction2(class extends PositronLayoutAction {
	constructor() {
		super(positronNotebookLayout);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.positronNewNotebookWithLayout',
			title: localize2('positronNewNotebookWithLayout', 'Create Notebook with Notebook Layout'),
			f1: false,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);
		const positronLayoutService = accessor.get(IPositronLayoutService);
		await commandService.executeCommand('ipynb.newUntitledIpynb');
		positronLayoutService.setLayout(positronNotebookLayout.layoutDescriptor);
	}
});
