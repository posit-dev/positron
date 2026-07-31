/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IConsoleError, IConsoleErrorFollowupService, IConsoleErrorSuggestion, IConsoleErrorSuggestionProvider } from '../../../services/positronConsole/common/consoleErrorFollowup.js';
import { IMissingPackagesService } from '../common/missingPackagesService.js';

/** Setting that gates the console install suggestion. */
const SUGGEST_INSTALL_ON_ERROR = 'packages.suggestInstallOnError';

/**
 * A console-error followup provider that offers to install a missing package
 * when a runtime reports a missing-module / missing-package error.
 *
 * It delegates recognition of the error to the session's runtime (which owns
 * its own error format and recovers the install name), then confirms the
 * package is actually installable in this environment before offering it, so
 * it never offers a package it cannot install. Going through the service
 * (rather than the session directly) shares the analysis cache, in-flight
 * dedupe, and resilience guards.
 */
export class MissingPackageErrorProvider implements IConsoleErrorSuggestionProvider {
	constructor(
		private readonly _missingPackagesService: IMissingPackagesService,
		private readonly _configurationService: IConfigurationService,
		private readonly _notificationService: INotificationService,
	) { }

	async provideSuggestions(error: IConsoleError, token: CancellationToken): Promise<IConsoleErrorSuggestion[]> {
		if (!this._configurationService.getValue<boolean>(SUGGEST_INSTALL_ON_ERROR)) {
			return [];
		}

		// Ask the session's runtime whether this error names a missing package,
		// then confirm it is actually installable. The runtime owns its own error
		// format, so this provider stays language-agnostic.
		const missing = await this._missingPackagesService.analyzeError(error.sessionId, error, token);

		return missing.map(pkg => ({
			icon: Codicon.lightBulb,
			label: localize('positron.missingPackages.installSuggestion', "Install {0}", pkg.name),
			run: async () => {
				try {
					await this._missingPackagesService.install({
						sessionId: error.sessionId,
						languageId: error.languageId,
						packages: [pkg],
					});
				} catch (err) {
					this._notificationService.error(localize(
						'positron.missingPackages.installFailed',
						"Failed to install '{0}': {1}",
						pkg.name,
						err instanceof Error ? err.message : String(err)));
				}
			},
		}));
	}
}

/**
 * Workbench contribution that registers the missing-package console-error
 * followup provider.
 */
export class MissingPackageFollowupContribution extends Disposable {
	static readonly ID = 'workbench.contrib.positronMissingPackageFollowup';

	constructor(
		@IConsoleErrorFollowupService consoleErrorFollowupService: IConsoleErrorFollowupService,
		@IMissingPackagesService missingPackagesService: IMissingPackagesService,
		@IConfigurationService configurationService: IConfigurationService,
		@INotificationService notificationService: INotificationService,
	) {
		super();
		const provider = new MissingPackageErrorProvider(
			missingPackagesService,
			configurationService,
			notificationService,
		);
		this._register(consoleErrorFollowupService.registerProvider(provider));
	}
}
