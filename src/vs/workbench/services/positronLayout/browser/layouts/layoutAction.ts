/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILocalizedString } from '../../../../../nls.js';
import { Categories } from '../../../../../platform/action/common/actionCommonCategories.js';
import { Action2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { ContextKeyExpression } from '../../../../../platform/contextkey/common/contextkey.js';
import { IPositronLayoutService } from '../interfaces/positronLayoutService.js';
import { CustomPositronLayoutDescription } from '../../common/positronCustomViews.js';
import { registerMatchableLayout } from './layoutMatch.js';
import { registerTaskLayout, TaskLayoutGroup } from './taskLayouts.js';


export type PositronLayoutInfo = {
	id: string;
	codicon?: string;
	label: ILocalizedString;
	layoutDescriptor: CustomPositronLayoutDescription;
	/**
	 * If true, the layout will not be shown in the command pallete and will need to be called
	 * programmatically.
	 */
	hideFromPalette?: boolean;
	/**
	 * Precondition controls enablement (for example for a menu item, show
	 * it in grey or for a command, do not allow to invoke it)
	 */
	precondition: ContextKeyExpression;
	/**
	 * Model-facing description of the layout. Required when
	 * {@link agentCompatible} is `true`.
	 */
	agentDescription?: string;
	/**
	 * When true, the layout is exposed to AI agents via
	 * `positron.ai.getAgentAllowedCommands()`.
	 */
	agentCompatible?: boolean;
	/**
	 * When set, the title bar's layout picker lists the layout under this short
	 * name, in this group and order. A task layout can also name view
	 * containers it hides.
	 */
	taskLayout?: { name: string; description?: string; group: TaskLayoutGroup; order: number; hiddenViewContainers?: readonly string[] };
};

export abstract class PositronLayoutAction extends Action2 {
	private _layout: CustomPositronLayoutDescription;
	private _layoutId: string;
	constructor(
		layoutInfo: PositronLayoutInfo
	) {
		const showInPalette = layoutInfo.hideFromPalette ? false : true;
		super({
			id: layoutInfo.id,
			title: layoutInfo.label,
			category: Categories.View,
			f1: showInPalette,
			precondition: layoutInfo.precondition,
			metadata: layoutInfo.agentCompatible ? {
				description: layoutInfo.agentDescription ?? layoutInfo.label.value,
				agentCompatible: true,
			} : undefined,
		});

		this._layout = layoutInfo.layoutDescriptor;
		this._layoutId = layoutInfo.id;
		registerMatchableLayout(layoutInfo);
		if (layoutInfo.taskLayout) {
			registerTaskLayout({
				id: layoutInfo.id,
				name: layoutInfo.taskLayout.name,
				description: layoutInfo.taskLayout.description,
				codicon: layoutInfo.codicon,
				group: layoutInfo.taskLayout.group,
				order: layoutInfo.taskLayout.order,
				hiddenViewContainers: layoutInfo.taskLayout.hiddenViewContainers ?? [],
				precondition: layoutInfo.precondition,
			});
		}
	}
	run(accessor: ServicesAccessor): void {
		const positronLayoutService = accessor.get(IPositronLayoutService);
		positronLayoutService.setLayout(this._layout, this._layoutId);
	}
}
