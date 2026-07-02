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

/** Python: `ModuleNotFoundError: No module named 'foo'`. */
const PYTHON_MISSING_MODULE_REGEX = /No module named ['"]([^'"]+)['"]/;

/**
 * R: `Error in library(foo) : there is no package called 'foo'`. R renders the
 * package name in curly quotes (U+2018/U+2019); accept those and straight quotes.
 */
const R_MISSING_PACKAGE_REGEX = /there is no package called ['"\u2018]([^'"\u2019]+)['"\u2019]/;

/**
 * A console-error followup provider that offers to install a missing package
 * when a runtime reports a missing-module / missing-package error.
 *
 * It routes a synthetic reference to the package through the missing-packages
 * service to confirm the package is actually installable in this environment
 * (and to recover the install name), so it never offers a package it cannot
 * install. Going through the service (rather than the session directly) shares
 * the analysis cache, in-flight dedupe, and resilience guards.
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

		const referencedName = extractMissingName(error);
		if (!referencedName) {
			return [];
		}

		// Analyze a synthetic reference to the package: it confirms the package is
		// missing AND installable, and recovers the install name.
		const code = syntheticReference(error.languageId, referencedName);
		if (!code) {
			return [];
		}

		const missing = await this._missingPackagesService.analyzeCode(error.sessionId, code, token);

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
					// Surface the failure so a click that does nothing visible
					// (network / package-manager error) isn't silently swallowed.
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

/** Extracts the referenced package/module name from a recognized error message. */
function extractMissingName(error: IConsoleError): string | undefined {
	if (error.languageId === 'python') {
		return PYTHON_MISSING_MODULE_REGEX.exec(error.message)?.[1];
	}
	if (error.languageId === 'r') {
		return R_MISSING_PACKAGE_REGEX.exec(error.message)?.[1];
	}
	return undefined;
}

/** Builds a minimal code snippet that references `name` for the analyzer to inspect. */
function syntheticReference(languageId: string, name: string): string | undefined {
	if (languageId === 'python') {
		return `import ${name}`;
	}
	if (languageId === 'r') {
		return `library(${name})`;
	}
	return undefined;
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
