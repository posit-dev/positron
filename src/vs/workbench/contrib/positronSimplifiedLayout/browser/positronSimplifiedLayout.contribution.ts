/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../common/views.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IPositronLayoutService } from '../../../services/positronLayout/browser/interfaces/positronLayoutService.js';
import { positronFourPaneDsLayout } from '../../../services/positronLayout/browser/layouts/positronFourPaneDsLayout.js';
import { positronTwoPaneLayout } from '../../../services/positronLayout/browser/layouts/positronTwoPaneLayout.js';
import { SIMPLIFIED_LAYOUT_ENABLED_KEY } from '../../../services/positronLayout/common/positronSimplifiedLayoutConfiguration.js';
import './titleBarSessionPicker.js';
import { PositronToolsContainerContribution } from './positronToolsContainer.js';
import { RemoteExplorerHiddenContextContribution } from './remoteExplorerCommands.js';

/**
 * Remembers that the starting layout was applied. The profile key covers what the profile
 * saves (where each view lives), so the Default layout is put back once when the setting turns
 * off. The workspace key covers what each folder saves (which views are collapsed, whether the
 * bottom panel is open), so each folder gets the starting layout once.
 *
 * The key changed when the Data Analysis layout replaced the Simplified layout as the starting
 * layout, so folders that already had the Simplified layout get the new one once.
 */
const SIMPLIFIED_LAYOUT_APPLIED_STORAGE_KEY = 'positron.simplifiedLayout.startingLayoutApplied';

/**
 * Applies the Data Analysis layout the first time each folder opens with the simplified layout
 * setting on, and puts back the Default layout the first time a window starts with the setting
 * off again. A saved layout otherwise wins over any new default, so without this an existing
 * user would never see the new layout.
 */
class SimplifiedLayoutStartupContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronSimplifiedLayoutStartup';

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IPositronLayoutService positronLayoutService: IPositronLayoutService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
	) {
		super();

		const enabled = configurationService.getValue<boolean>(SIMPLIFIED_LAYOUT_ENABLED_KEY) === true;
		const appliedToProfile = storageService.getBoolean(SIMPLIFIED_LAYOUT_APPLIED_STORAGE_KEY, StorageScope.PROFILE, false);
		const appliedToWorkspace = storageService.getBoolean(SIMPLIFIED_LAYOUT_APPLIED_STORAGE_KEY, StorageScope.WORKSPACE, false);

		if (enabled && (!appliedToProfile || !appliedToWorkspace)) {
			positronLayoutService.setLayout(positronTwoPaneLayout.layoutDescriptor, positronTwoPaneLayout.id);
			storageService.store(SIMPLIFIED_LAYOUT_APPLIED_STORAGE_KEY, true, StorageScope.PROFILE, StorageTarget.MACHINE);
			storageService.store(SIMPLIFIED_LAYOUT_APPLIED_STORAGE_KEY, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} else if (enabled) {
			// The bottom panel can come back open with nothing in it, for example after Toggle
			// Panel or when the window closed before the folder's layout was saved.
			const panelIsEmpty = viewDescriptorService.getViewContainersByLocation(ViewContainerLocation.Panel)
				.every(container => viewDescriptorService.getViewContainerModel(container).activeViewDescriptors.length === 0);
			if (panelIsEmpty && layoutService.isVisible(Parts.PANEL_PART)) {
				layoutService.setPartHidden(true, Parts.PANEL_PART);
			}
		} else if (appliedToProfile) {
			positronLayoutService.setLayout(positronFourPaneDsLayout.layoutDescriptor, positronFourPaneDsLayout.id);
			storageService.remove(SIMPLIFIED_LAYOUT_APPLIED_STORAGE_KEY, StorageScope.PROFILE);
			storageService.remove(SIMPLIFIED_LAYOUT_APPLIED_STORAGE_KEY, StorageScope.WORKSPACE);
		}
	}
}

registerWorkbenchContribution2(
	SimplifiedLayoutStartupContribution.ID,
	SimplifiedLayoutStartupContribution,
	WorkbenchPhase.AfterRestored
);

registerWorkbenchContribution2(
	PositronToolsContainerContribution.ID,
	PositronToolsContainerContribution,
	WorkbenchPhase.BlockStartup
);

registerWorkbenchContribution2(
	RemoteExplorerHiddenContextContribution.ID,
	RemoteExplorerHiddenContextContribution,
	WorkbenchPhase.BlockStartup
);
