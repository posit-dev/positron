/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILocalizedString } from 'vs/nls';
import { Categories } from 'vs/platform/action/common/actionCommonCategories';
import { Action2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IPositronLayoutService } from 'vs/workbench/services/positronLayout/browser/interfaces/positronLayoutService';
import { CustomPositronLayoutDescription } from 'vs/workbench/services/positronLayout/common/positronCustomViews';


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
			f1: showInPalette
		});

		this._layout = layoutInfo.layoutDescriptor;
	}
	run(accessor: ServicesAccessor): void {
		const positronLayoutService = accessor.get(IPositronLayoutService);
		positronLayoutService.setLayout(this._layout);
	}
}
