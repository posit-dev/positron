/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Action2 } from 'vs/platform/actions/common/actions';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';

export const POSITRON_VARIABLES_ACTION_CATEGORY = nls.localize('positronVariablesCategory', "Variables");
const category: ILocalizedString = { value: POSITRON_VARIABLES_ACTION_CATEGORY, original: 'Variables' };

export class PositronVariablesRefreshAction extends Action2 {

	static ID = 'workbench.action.positronVariables.refresh';

	constructor() {
		super({
			id: PositronVariablesRefreshAction.ID,
			title: { value: 'Refresh Variables', original: 'Refresh Variables' },
			f1: true,
			category
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The service accessor.
	 */
	async run(accessor: ServicesAccessor) {
		// TODO(jmcphers): This should ask the Positron variables service to refresh.
	}
}
