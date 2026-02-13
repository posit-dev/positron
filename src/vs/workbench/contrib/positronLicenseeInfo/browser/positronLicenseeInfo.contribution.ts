/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from '../../../common/contributions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { IRemoteAgentService } from '../../../services/remote/common/remoteAgentService.js';

/**
 * Status bar entry ID for the licensee info display.
 */
const POSITRON_LICENSEE_INFO_STATUS_ID = 'status.positronLicenseeInfo';

/**
 * Workbench contribution that displays licensee info in the status bar.
 */
class PositronLicenseeInfoStatusBarContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.positronLicenseeInfoStatusBar';

	constructor(
		@IStatusbarService private readonly _statusbarService: IStatusbarService,
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService
	) {
		super();
		this._updateStatusBar().catch(err => console.error('Failed to update licensee info status bar:', err));
	}

	private async _updateStatusBar(): Promise<void> {
		const environment = await this._remoteAgentService.getEnvironment();
		const licenseeInfo = environment?.positronLicenseeInfo;

		if (!licenseeInfo?.licensee) {
			// No licensee info - don't show anything
			return;
		}

		// Build tooltip text
		let tooltip = localize('positronLicenseeInfo.tooltip.licensee', "Licensed to: {0}", licenseeInfo.licensee);
		if (licenseeInfo.issuer) {
			tooltip += '\n' + localize('positronLicenseeInfo.tooltip.issuer', "Issued by: {0}", licenseeInfo.issuer);
		}

		// Create status bar entry and track for disposal
		this._register(this._statusbarService.addEntry(
			{
				name: localize('positronLicenseeInfo.name', "License Info"),
				text: localize('positronLicenseeInfo.text', "Licensed to: {0}", licenseeInfo.licensee),
				tooltip,
				ariaLabel: tooltip
			},
			POSITRON_LICENSEE_INFO_STATUS_ID,
			StatusbarAlignment.RIGHT,
			-1 // Low priority - show at the far right
		));
	}
}

// Register the contribution
const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(PositronLicenseeInfoStatusBarContribution, LifecyclePhase.Restored);
