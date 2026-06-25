/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IConsoleError, IConsoleErrorFollowupService, IConsoleErrorSuggestion, IConsoleErrorSuggestionProvider } from '../../../services/positronConsole/common/consoleErrorFollowup.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
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
 * It reuses the session's `listMissingPackages` analyzer to confirm the package
 * is actually installable in this environment (and to recover the install name),
 * so it never offers a package it cannot install.
 */
export class MissingPackageErrorProvider implements IConsoleErrorSuggestionProvider {
	constructor(
		private readonly _runtimeSessionService: IRuntimeSessionService,
		private readonly _missingPackagesService: IMissingPackagesService,
		private readonly _configurationService: IConfigurationService,
	) { }

	async provideSuggestions(error: IConsoleError, token: CancellationToken): Promise<IConsoleErrorSuggestion[]> {
		if (!this._configurationService.getValue<boolean>(SUGGEST_INSTALL_ON_ERROR)) {
			return [];
		}

		const referencedName = extractMissingName(error);
		if (!referencedName) {
			return [];
		}

		const session = this._runtimeSessionService.getSession(error.sessionId);
		if (!session?.listMissingPackages) {
			return [];
		}

		// Reuse the analyzer on a synthetic reference to the package: it confirms
		// the package is missing AND installable, and recovers the install name.
		const code = syntheticReference(error.languageId, referencedName);
		if (!code) {
			return [];
		}

		let missing;
		try {
			missing = await session.listMissingPackages({ code }, token);
		} catch {
			return [];
		}

		return missing.map(pkg => ({
			icon: Codicon.lightBulb,
			label: localize('positron.missingPackages.installSuggestion', "Install {0}", pkg.name),
			run: async () => {
				await this._missingPackagesService.install({
					sessionId: error.sessionId,
					languageId: error.languageId,
					packages: [pkg],
				});
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
		@IRuntimeSessionService runtimeSessionService: IRuntimeSessionService,
		@IMissingPackagesService missingPackagesService: IMissingPackagesService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super();
		const provider = new MissingPackageErrorProvider(
			runtimeSessionService,
			missingPackagesService,
			configurationService,
		);
		this._register(consoleErrorFollowupService.registerProvider(provider));
	}
}
