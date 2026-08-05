/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect } from '@playwright/test';
import { Application } from '../../infra';

type PackageAction = 'install' | 'uninstall';

const Packages = [
	{ name: 'renv', type: 'R' },
	{ name: 'snowflake', type: 'Python' }
] as const;

type PackageName = (typeof Packages[number])['name']; // "ipykernel" | "renv", etc

export class PackageManager {
	private app: Application;

	constructor(app: Application) {
		this.app = app;
	}

	/**
	 * Manages the installation or uninstallation of a package.
	 * @param packageName The name of the package (e.g., ipykernel or renv).
	 * @param action The action to perform ('install' or 'uninstall').
	 */
	async manage(packageName: PackageName, action: PackageAction): Promise<void> {
		const packageInfo = Packages.find(pkg => pkg.name === packageName);
		if (!packageInfo) {
			throw new Error(`Package ${packageName} not found`);
		}

		await test.step(`${action}: ${packageName}`, async () => {
			const command = this.getCommand(packageInfo.type, packageName, action);
			const expectedOutput = this.getExpectedOutput(packageName, action);

			await this.app.workbench.console.executeCode(packageInfo.type, command);
			await expect(this.app.code.driver.currentPage.getByText(expectedOutput)).toBeVisible();

			if (packageInfo.type === 'R') {
				// The output matched above is printed when `install.packages()` starts, not when it
				// finishes, and the console keeps showing the `>` prompt while it runs, so
				// `executeCode`'s readiness check returns almost immediately. Wait for the call to
				// actually return -- otherwise a caller that creates a new folder next reloads the
				// window and kills the session mid-install.
				await this.app.workbench.console.waitForConsoleExecution({ timeout: 120000 });

				if (action === 'install') {
					// Confirm the package really landed, so a failed install fails here instead of
					// surfacing later as an unexpected "Missing R package" modal blocking the
					// workbench. Only checked for `install`: after `remove.packages()`,
					// `requireNamespace` still reports TRUE if the namespace is already loaded in
					// the session (which it is in an renv-activated folder).
					await this.app.workbench.console.executeCode(
						'R',
						`cat("${packageName}-available:", requireNamespace("${packageName}", quietly = TRUE), "\\n")`
					);
					await this.app.workbench.console.waitForConsoleContents(`${packageName}-available: TRUE`);
				}
			}
		});
	}

	/**
	 * Returns the command for the specified action.
	 * @param language The language associated with the package ('R' or 'Python').
	 * @param packageName The name of the package.
	 * @param action The action to perform ('install' or 'uninstall').
	 */
	private getCommand(language: 'R' | 'Python', packageName: PackageName, action: PackageAction): string {
		if (language === 'Python') {
			return action === 'install'
				? `pip install ${packageName}`
				: `pip uninstall -y ${packageName}`;
		} else {
			return action === 'install'
				? `install.packages("${packageName}", repos = "https://packagemanager.posit.co/cran/latest")`
				: `remove.packages("${packageName}")`;
		}
	}

	/**
	 * Returns the expected console output for the specified action.
	 * @param packageName The name of the package.
	 * @param action The action to perform ('install' or 'uninstall').
	 */
	private getExpectedOutput(packageName: PackageName, action: PackageAction): RegExp {
		switch (packageName) {
			case 'snowflake':
				return /you may need to restart the kernel to use updated packages/;
			default:
				return action === 'install' ? /Installing|Downloading|Fetched/ : /Removing|Uninstalling/;
		}
	}
}
