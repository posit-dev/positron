/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Action2 } from '../../../../platform/actions/common/actions.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';

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
