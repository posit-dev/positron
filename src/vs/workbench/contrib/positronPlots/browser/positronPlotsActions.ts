/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { Action2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';

export const POSITRON_PLOTS_ACTION_CATEGORY = nls.localize('positronPlotsCategory', "Plots");
const category: ILocalizedString = { value: POSITRON_PLOTS_ACTION_CATEGORY, original: 'Plots' };

export class PlotsRefreshAction extends Action2 {

	static ID = 'workbench.action.positronPlots.refresh';

	constructor() {
		super({
			id: PlotsRefreshAction.ID,
			title: { value: 'Refresh Plots', original: 'Refresh Plots' },
			f1: true,
			category
		});
	}

	/**
	 * Runs the action and refreshes the plots.
	 *
	 * @param accessor The service accessor.
	 */
	async run(accessor: ServicesAccessor) {
		// TODO: Implement a plots service.
	}
}
