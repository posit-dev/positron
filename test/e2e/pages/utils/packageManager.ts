/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test from '@playwright/test';
import { Application } from '../../infra';

type PackageAction = 'install' | 'uninstall';

interface Package {
	name: string;
	type: 'Python' | 'R';
}

const Packages = [
	{ name: 'ipykernel', type: 'Python' },
	{ name: 'renv', type: 'R' }
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
		const packageInfo = this.getPackageInfo(packageName);
		if (!packageInfo) {
			throw new Error(`Invalid package name: ${packageName}`);
		}

		await test.step(`${action}: ${packageName}`, async () => {
			const command = this.getCommand(packageInfo.type, packageName, action);
			const expectedOutput = this.getExpectedOutput(packageName, action);
			const prompt = packageInfo.type === 'Python' ? '>>> ' : '> ';

			await this.app.workbench.console.executeCode(packageInfo.type, command, prompt);
			await this.app.workbench.console.waitForConsoleContents(expectedOutput);
		});
	}

	/**
	 * Returns the corresponding package info.
	 * @param packageName The name of the package.
	 * @returns The package info (name and type) if valid, otherwise undefined.
	 */
	private getPackageInfo(packageName: PackageName): Package | undefined {
		return Packages.find(pkg => pkg.name === packageName);
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
				? `install.packages("${packageName}")`
				: `remove.packages("${packageName}")`;
		}
	}

	/**
	 * Returns the expected console output for the specified action.
	 * @param packageName The name of the package.
	 * @param action The action to perform ('install' or 'uninstall').
	 */
	private getExpectedOutput(packageName: PackageName, action: PackageAction): string {
		switch (packageName) {
			case 'ipykernel':
				return action === 'install'
					? `Note: you may need to restart the kernel to use updated packages.`
					: `Successfully uninstalled ipykernel`;
			case 'renv':
				return action === 'install'
					? `Installing package`
					: `Removing package`;
			default:
				return action === 'install' ? `Installing` : `Removing`;
		}
	}
}
