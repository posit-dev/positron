/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { LOGGER } from './extension.js';

/**
 * Zed Package Manager
 *
 * Provides mock package management functionality for the Zed test runtime.
 */
export class ZedPackageManager implements positron.LanguageRuntimePackageManager {
	/**
	 * Current installed packages.
	 */
	private _packages: positron.LanguageRuntimePackage[] = [
		{ name: 'zed-core', version: '1.0.0' },
		{ name: 'zed-stdlib', version: '1.2.4' },
		{ name: 'zed-runtime', version: '0.9.8' },
		{ name: 'zed-io', version: '2.1.0' },
		{ name: 'zed-net', version: '1.4.2' }
	].map((pkg) => ({ id: pkg.name, name: pkg.name, displayName: pkg.name, version: pkg.version }));

	/**
	 * All available packages in the mock repository.
	 */
	private readonly _availablePackages: positron.LanguageRuntimePackage[] = [
		{ name: 'zed-core', version: '1.0.0' },
		{ name: 'zed-stdlib', version: '1.2.4' },
		{ name: 'zed-runtime', version: '0.9.8' },
		{ name: 'zed-io', version: '2.1.0' },
		{ name: 'zed-net', version: '1.4.2' },
		{ name: 'zed-crypto', version: '0.7.3' },
		{ name: 'zed-fmt', version: '3.0.1' },
		{ name: 'zed-testkit', version: '1.1.0' },
		{ name: 'zed-async', version: '2.0.0-beta.2' },
		{ name: 'zed-cli', version: '0.5.6' },
		{ name: 'zed-packager', version: '1.0.0-rc.1' },
		{ name: 'zed-vm', version: '4.3.9' }
	].map((pkg) => ({ id: pkg.name, name: pkg.name, displayName: pkg.name, version: pkg.version }));

	async getPackages(): Promise<positron.LanguageRuntimePackage[]> {
		LOGGER.info('Getting installed packages...');
		await new Promise((resolve) => setTimeout(resolve, 2_500)); // fake delay

		LOGGER.info(`${this._packages.length} packages installed:\n${this._packages.map((pkg) => `${pkg.name}@${pkg.version}`).join('\n')}`);
		return this._packages;
	}

	async installPackages(packages: positron.PackageSpec[]): Promise<void> {
		LOGGER.info(`Installing packages: ${packages.map(p => p.name).join(', ')}`);
		await new Promise((resolve) => setTimeout(resolve, 1_000)); // fake delay
		for (const pkg of packages) {
			// Check if already installed
			const existing = this._packages.findIndex(p => p.name === pkg.name);
			if (existing !== -1) {
				// Update version if already installed
				this._packages[existing].version = pkg.version ?? '1.0.0';
			} else {
				this._packages.push({
					id: pkg.name,
					name: pkg.name,
					displayName: pkg.name,
					version: pkg.version ?? '1.0.0'
				});
			}
		}
	}

	async updatePackages(packages: positron.PackageSpec[]): Promise<void> {
		LOGGER.info(`Updating packages: ${packages.map(p => p.name).join(', ')}`);
		await new Promise((resolve) => setTimeout(resolve, 1_000)); // fake delay

		for (const pkg of packages) {
			const index = this._packages.findIndex(p => p.name === pkg.name);
			if (index === -1) {
				throw new Error(`Package '${pkg.name}' is not installed.`);
			}

			this._packages.splice(index, 1, {
				id: pkg.name,
				name: pkg.name,
				displayName: pkg.name,
				version: pkg.version ?? '9.9.9'
			});
		}
	}

	async updateAllPackages(): Promise<void> {
		LOGGER.info('Updating all packages...');
		await new Promise((resolve) => setTimeout(resolve, 5_000)); // fake delay

		for (const pkg of this._packages) {
			pkg.version = '9.9.9';
		}
	}

	async uninstallPackages(packageNames: string[]): Promise<void> {
		LOGGER.info(`Uninstalling packages: ${packageNames.join(', ')}`);
		await new Promise((resolve) => setTimeout(resolve, 1_000)); // fake delay
		for (const name of packageNames) {
			const index = this._packages.findIndex(pkg => pkg.name === name);
			if (index === -1) {
				throw new Error(`Package '${name}' is not installed.`);
			}

			this._packages.splice(index, 1);
		}
	}

	async searchPackages(query: string): Promise<positron.LanguageRuntimePackage[]> {
		LOGGER.debug(`Searching for packages matching: ${query}`);
		await new Promise((resolve) => setTimeout(resolve, 1_500)); // fake delay

		return this._availablePackages
			.filter((pkg) => pkg.name.toLowerCase().includes(query.toLowerCase()));
	}

	async searchPackageVersions(name: string): Promise<string[]> {
		LOGGER.debug(`Searching for package versions matching: ${name}`);
		await new Promise((resolve) => setTimeout(resolve, 1_500)); // fake delay

		return ['1.0.0', '1.1.0', '1.2.0', '2.0.0', '2.1.0'];
	}
}
