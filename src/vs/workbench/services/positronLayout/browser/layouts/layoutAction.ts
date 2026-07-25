/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILocalizedString } from '../../../../../nls.js';
import { Categories } from '../../../../../platform/action/common/actionCommonCategories.js';
import { Action2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { ICommandMetadata } from '../../../../../platform/commands/common/commands.js';
import { ContextKeyExpression } from '../../../../../platform/contextkey/common/contextkey.js';
import { IPositronLayoutService } from '../interfaces/positronLayoutService.js';
import { CustomPositronLayoutDescription } from '../../common/positronCustomViews.js';


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
	 * Command metadata, e.g. to expose the layout command to AI agents.
	 */
	metadata?: ICommandMetadata;
};

export abstract class PositronLayoutAction extends Action2 {
	private _layout: CustomPositronLayoutDescription;
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
			metadata: layoutInfo.metadata
		});

		this._layout = layoutInfo.layoutDescriptor;
	}
	run(accessor: ServicesAccessor): void {
		const positronLayoutService = accessor.get(IPositronLayoutService);
		positronLayoutService.setLayout(this._layout);
	}
}
