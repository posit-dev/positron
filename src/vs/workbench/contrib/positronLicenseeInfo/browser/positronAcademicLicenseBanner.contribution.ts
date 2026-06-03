/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { isWeb, isWorkbench } from '../../../../base/common/platform.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from '../../../common/contributions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IBannerService } from '../../../services/banner/browser/bannerService.js';
import { IRemoteAgentService } from '../../../services/remote/common/remoteAgentService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

const BANNER_ID = 'positron.academicLicense';
const DISMISSED_KEY = 'workbench.banner.academicLicense.dismissed';
const LICENSE_TERMS_URL = 'https://positron.posit.co/licensing.html#positron-education-license-rider';

class PositronAcademicLicenseBannerContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.positronAcademicLicenseBanner';

	constructor(
		@IBannerService private readonly _bannerService: IBannerService,
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();

		// Only show on web builds that are not Posit Workbench.
		if (!isWeb || isWorkbench) {
			return;
		}

		this._showBannerIfNeeded().catch(err =>
			console.error('Failed to check academic license banner:', err)
		);
	}

	private async _showBannerIfNeeded(): Promise<void> {
		const environment = await this._remoteAgentService.getEnvironment();
		if (!environment?.positronLicenseeInfo?.isAcademic) {
			return;
		}

		if (this._storageService.getBoolean(DISMISSED_KEY, StorageScope.PROFILE, false)) {
			return;
		}

		this._bannerService.show({
			id: BANNER_ID,
			icon: undefined,
			message: localize(
				'positron.academicLicense.banner',
				"You are using Positron under an academic license."
			),
			actions: [
				{
					label: localize('positron.academicLicense.viewTerms', "View License Terms"),
					href: LICENSE_TERMS_URL,
				}
			],
			onClose: () => {
				this._storageService.store(
					DISMISSED_KEY,
					true,
					StorageScope.PROFILE,
					StorageTarget.MACHINE
				);
			}
		});
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(PositronAcademicLicenseBannerContribution, LifecyclePhase.Restored);
