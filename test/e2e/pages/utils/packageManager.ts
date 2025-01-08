/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test from '@playwright/test';

type PackageAction = 'install' | 'uninstall';
type PackageName = 'ipykernel';

export class PackageManager {
	private app: any;

	constructor(app: any) {
		this.app = app;
	}

	/**
	 * Manages the installation or uninstallation of a package.
	 * @param packageName The name of the package (e.g., ipykernel).
	 * @param action The action to perform ('install' or 'uninstall').
	 */
	async manage(packageName: PackageName, action: PackageAction): Promise<void> {
		await test.step(`${action}: ${packageName}`, async () => {
			const command = this.getCommand(packageName, action);
			const expectedOutput = this.getExpectedOutput(packageName, action);

			try {
				await this.app.workbench.console.typeToConsole(command, 10, true);
				await this.app.workbench.console.waitForConsoleContents(expectedOutput);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`Failed to ${action} ${packageName}: ${message}`);
			}
		});
	}

	/**
	 * Returns the command for the specified action.
	 * @param packageName The name of the package.
	 * @param action The action to perform ('install' or 'uninstall').
	 */
	private getCommand(packageName: string, action: PackageAction): string {
		switch (packageName) {
			case 'ipykernel':
			case 'pandas':
				return action === 'install'
					? `pip install ${packageName}`
					: `pip uninstall -y ${packageName}`;

			default:
				throw new Error(`Unknown package or unsupported package manager for ${packageName}`);
		}
	}

	/**
	 * Returns the expected console output for the specified action.
	 * @param packageName The name of the package.
	 * @param action The action to perform ('install' or 'uninstall').
	 */
	private getExpectedOutput(packageName: string, action: PackageAction): string {
		switch (packageName) {
			case 'ipykernel':
				return action === 'install'
					? `Note: you may need to restart the kernel to use updated packages.`
					: `Successfully uninstalled ipykernel`;

			default:
				return action === 'install'
					? `Successfully installed ${packageName}`
					: `Successfully uninstalled ${packageName}`;

		}
	}
}
