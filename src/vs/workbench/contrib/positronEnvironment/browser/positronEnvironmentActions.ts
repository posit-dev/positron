/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { Action2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';

export const POSITRON_ENVIRONMENT_ACTION_CATEGORY = nls.localize('positronEnvironmentCategory', "Environment");
const category: ILocalizedString = { value: POSITRON_ENVIRONMENT_ACTION_CATEGORY, original: 'Environment' };

export class EnvironmentRefreshAction extends Action2 {

	static ID = 'workbench.action.positronEnvironment.refresh';

	constructor() {
		super({
			id: EnvironmentRefreshAction.ID,
			title: { value: 'Refresh Environment', original: 'Refresh Environment' },
			f1: true,
			category
		});
	}

	/**
	 * Runs the action and refreshes the environment.
	 *
	 * @param accessor The service accessor.
	 */
	async run(accessor: ServicesAccessor) {
		// TODO(jmcphers): This should ask the Positron environment service to
		// refresh the environment, but that service doesn't yet own the set of
		// active environments.
	}
}
