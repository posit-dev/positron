/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IPositronLayoutService } from '../../../services/positronLayout/browser/interfaces/positronLayoutService.js';
import { positronFourPaneDsLayout } from '../../../services/positronLayout/browser/layouts/positronFourPaneDsLayout.js';
import { positronSimplifiedLayout } from '../../../services/positronLayout/browser/layouts/positronSimplifiedLayout.js';
import { SIMPLIFIED_LAYOUT_ENABLED_KEY } from '../../../services/positronLayout/common/positronSimplifiedLayoutConfiguration.js';

/**
 * Remembers that the Simplified layout was applied for this profile, so it is applied once
 * when the setting turns on and undone once when it turns off.
 */
const SIMPLIFIED_LAYOUT_APPLIED_STORAGE_KEY = 'positron.simplifiedLayout.applied';

/**
 * Applies the Simplified layout the first time the window starts with the simplified layout
 * setting on, and puts back the Stacked layout the first time it starts with the setting off
 * again. A saved layout in the profile otherwise wins over any new default, so without this
 * an existing user would never see the new layout.
 */
class SimplifiedLayoutStartupContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronSimplifiedLayoutStartup';

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IPositronLayoutService positronLayoutService: IPositronLayoutService,
	) {
		super();

		const enabled = configurationService.getValue<boolean>(SIMPLIFIED_LAYOUT_ENABLED_KEY) === true;
		const applied = storageService.getBoolean(SIMPLIFIED_LAYOUT_APPLIED_STORAGE_KEY, StorageScope.PROFILE, false);

		if (enabled && !applied) {
			positronLayoutService.setLayout(positronSimplifiedLayout.layoutDescriptor);
			storageService.store(SIMPLIFIED_LAYOUT_APPLIED_STORAGE_KEY, true, StorageScope.PROFILE, StorageTarget.MACHINE);
		} else if (!enabled && applied) {
			positronLayoutService.setLayout(positronFourPaneDsLayout.layoutDescriptor);
			storageService.remove(SIMPLIFIED_LAYOUT_APPLIED_STORAGE_KEY, StorageScope.PROFILE);
		}
	}
}

registerWorkbenchContribution2(
	SimplifiedLayoutStartupContribution.ID,
	SimplifiedLayoutStartupContribution,
	WorkbenchPhase.AfterRestored
);
