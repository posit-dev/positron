/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IMissingPackagesService } from '../common/missingPackagesService.js';
import { PreflightDecision, showMissingPackagesPreflightModal } from './missingPackagesPreflightModal.js';

/** Setting that gates the preflight modal. */
export const CONFIRM_MISSING_ON_RUN = 'packages.confirmMissingOnRun';

export const IMissingPackagesPreflightService = createDecorator<IMissingPackagesPreflightService>('missingPackagesPreflightService');

export interface IMissingPackagesPreflightService {
	readonly _serviceBrand: undefined;

	/**
	 * Runs the preflight check for a run gesture and, if the user chooses to,
	 * installs the missing packages. Resolves with whether the caller should
	 * proceed to run.
	 *
	 * Never blocks on computation: if the missing-package set is not already
	 * cached, this returns `true` immediately (the console detector is the
	 * backstop).
	 *
	 * @param resource The file/notebook about to run.
	 * @returns true if the caller should proceed to run; false if cancelled.
	 */
	confirmBeforeRun(resource: URI): Promise<boolean>;
}

/**
 * Default implementation of {@link IMissingPackagesPreflightService}.
 */
export class MissingPackagesPreflightService implements IMissingPackagesPreflightService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IMissingPackagesService private readonly _missingPackagesService: IMissingPackagesService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@INotificationService private readonly _notificationService: INotificationService,
	) { }

	async confirmBeforeRun(resource: URI): Promise<boolean> {
		const decision = await this._checkBeforeRun(resource);
		if (decision === 'cancel') {
			return false;
		}
		if (decision === 'install-and-run') {
			await this._installMissing(resource);
		}
		return true;
	}

	/**
	 * Determines the preflight decision, showing the modal only when there is a
	 * cached, non-empty missing-package set and the setting is enabled.
	 */
	private async _checkBeforeRun(resource: URI): Promise<PreflightDecision> {
		if (!this._configurationService.getValue<boolean>(CONFIRM_MISSING_ON_RUN)) {
			return 'run';
		}

		// Never block the gesture on a computation. If we don't have a result
		// yet, run anyway and warm the cache for next time.
		const result = this._missingPackagesService.getCached(resource);
		if (!result) {
			this._missingPackagesService.ensure(resource).catch(() => { });
			return 'run';
		}
		if (result.total === 0) {
			return 'run';
		}

		const packageNames = result.groups.flatMap(group => group.packages.map(pkg => pkg.name));
		const { decision, dontShowAgain } = await showMissingPackagesPreflightModal(basename(resource), packageNames);

		if (dontShowAgain) {
			// Dismissing turns preflight off everywhere.
			await this._configurationService.updateValue(CONFIRM_MISSING_ON_RUN, false, ConfigurationTarget.USER);
		}
		return decision;
	}

	/**
	 * Installs the cached missing packages. On failure, surfaces a non-blocking
	 * notification and returns normally so the caller still runs (preserving the
	 * "...and run" intent); the console detector then offers a retry.
	 */
	private async _installMissing(resource: URI): Promise<void> {
		const result = this._missingPackagesService.getCached(resource);
		if (!result) {
			return;
		}
		for (const group of result.groups) {
			try {
				await this._missingPackagesService.install(group);
			} catch (err) {
				this._notificationService.warn(localize(
					'positron.missingPackages.installFailed',
					"Failed to install missing packages: {0}", String(err)
				));
			}
		}
	}
}
