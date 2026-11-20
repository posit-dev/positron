/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../../nls.js';
import { registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { Parts } from '../../../layout/browser/layoutService.js';
import { SIMPLIFIED_LAYOUT_ENABLED_KEY } from '../../common/positronSimplifiedLayoutConfiguration.js';
import { PositronLayoutAction, PositronLayoutInfo } from './layoutAction.js';

/**
 * The layout for the simplified UI spike. There is no bottom panel: the console, terminal,
 * variables, and plots are stacked in the Session container in the secondary side bar. Only
 * the console starts expanded; the plots view expands itself when a plot is drawn.
 *
 * Applying it also moves every container and view it does not list back to its default
 * place, so picking it again undoes anything the user has moved.
 */
export const positronSimplifiedLayout: PositronLayoutInfo = {
	id: 'workbench.action.positronSimplifiedLayout',
	codicon: 'positron-two-pane-ds-layout',
	label: localize2('choseLayout.simplified', 'Simplified Layout'),
	precondition: ContextKeyExpr.equals(`config.${SIMPLIFIED_LAYOUT_ENABLED_KEY}`, true),
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
							id: 'terminal',
							collapsed: true,
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
		super(positronSimplifiedLayout);
	}
});
