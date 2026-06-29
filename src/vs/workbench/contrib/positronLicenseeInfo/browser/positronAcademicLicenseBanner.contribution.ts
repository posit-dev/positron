/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { FileAccess } from '../../../../base/common/network.js';
import { isWeb, isWorkbench } from '../../../../base/common/platform.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from '../../../common/contributions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IBannerService } from '../../../services/banner/browser/bannerService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import * as fs from 'fs';

const BANNER_ID = 'positron.academicLicense';
const DISMISSED_KEY = 'workbench.banner.academicLicense.dismissed';
const LICENSE_TERMS_URL = 'https://positron.posit.co/licensing.html#positron-education-license-rider';

export const SHOW_ACADEMIC_LICENSE_BANNER_COMMAND_ID = 'positron.showAcademicLicenseBanner';

class PositronAcademicLicenseBannerContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.positronAcademicLicenseBanner';

	constructor(
		@IBannerService private readonly _bannerService: IBannerService,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();

		const hasWebUi = fs.existsSync(FileAccess.asFileUri('vs/code/browser/workbench/workbench.html').fsPath);

		// Only show on web builds that are not Posit Workbench, nor remote ssh (which doesn't have web ui)
		if (!isWeb || isWorkbench || !hasWebUi) {
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
				"By using Positron, you agree to the terms of the Positron license and the Education License Rider."
			),
			actions: [
				{
					label: localize('positron.academicLicense.viewTerms', "View Terms"),
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

CommandsRegistry.registerCommand(SHOW_ACADEMIC_LICENSE_BANNER_COMMAND_ID, (accessor: ServicesAccessor) => {
	const bannerService = accessor.get(IBannerService);
	const storageService = accessor.get(IStorageService);
	bannerService.show({
		id: BANNER_ID,
		icon: undefined,
		message: localize(
			'positron.academicLicense.banner',
			"By using Positron, you agree to the terms of the Positron license and the Education License Rider."
		),
		actions: [
			{
				label: localize('positron.academicLicense.viewTerms', "View Terms"),
				href: LICENSE_TERMS_URL,
			}
		],
		onClose: () => {
			storageService.store(
				DISMISSED_KEY,
				true,
				StorageScope.PROFILE,
				StorageTarget.MACHINE
			);
		}
	});
});
