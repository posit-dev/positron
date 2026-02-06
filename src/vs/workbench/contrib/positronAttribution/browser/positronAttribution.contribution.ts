/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from '../../../common/contributions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { IPositronAttributionService } from '../../../services/positronAttribution/common/positronAttribution.js';

/**
 * Status bar entry ID for the license attribution display.
 */
const POSITRON_ATTRIBUTION_STATUS_ID = 'status.positronAttribution';

/**
 * Workbench contribution that displays license attribution in the status bar.
 */
class PositronAttributionStatusBarContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.positronAttributionStatusBar';

	constructor(
		@IStatusbarService private readonly _statusbarService: IStatusbarService,
		@IPositronAttributionService private readonly _attributionService: IPositronAttributionService
	) {
		super();
		this._updateStatusBar().catch(err => console.error('Failed to update attribution status bar:', err));
	}

	private async _updateStatusBar(): Promise<void> {
		const attribution = await this._attributionService.getAttribution();

		if (!attribution?.licensee) {
			// No license attribution - don't show anything
			return;
		}

		// Build tooltip text
		let tooltip = localize('positronAttribution.tooltip.licensee', "Licensed to: {0}", attribution.licensee);
		if (attribution.issuer) {
			tooltip += '\n' + localize('positronAttribution.tooltip.issuer', "Issued by: {0}", attribution.issuer);
		}

		// Create status bar entry and track for disposal
		this._register(this._statusbarService.addEntry(
			{
				name: localize('positronAttribution.name', "License Attribution"),
				text: localize('positronAttribution.text', "Licensed to: {0}", attribution.licensee),
				tooltip,
				ariaLabel: tooltip
			},
			POSITRON_ATTRIBUTION_STATUS_ID,
			StatusbarAlignment.RIGHT,
			-1 // Low priority - show at the far right
		));
	}
}

// Register the contribution
const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(PositronAttributionStatusBarContribution, LifecyclePhase.Restored);
