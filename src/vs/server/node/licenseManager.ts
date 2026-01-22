/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from '../../base/common/path.js';

const execFileAsync = promisify(execFile);

/**
 * The JSON data structure returned by license-manager verify command.
 */
interface LicenseVerifyOutput {
	'trial-type': string;
	'status': string;
	'days-left': number;
	'license-scope': string;
	'license-engine': string;
}

/**
 * Wrapper for executing license-manager binary commands.
 */
class LicenseManager {
	constructor(private readonly licenseManagerPath: string) { }

	/**
	 * Runs a license-manager command and returns the stdout as a string.
	 * @param command The command to run (e.g., 'verify')
	 * @param args Optional arguments to pass to the command
	 * @returns The stdout from the command
	 */
	async runCommand(command: string, args: string[] = []): Promise<string> {
		try {
			const { stdout } = await execFileAsync(
				this.licenseManagerPath,
				[command, ...args],
				{ maxBuffer: 1024 * 1024, timeout: 10000 }
			);
			return stdout;
		} catch (error) {
			const cmdString = `${this.licenseManagerPath} ${command} ${args.join(' ')}`;
			throw new Error(`License manager command failed: ${cmdString}\nError: ${error.message}`);
		}
	}

	/**
	 * Validates a license file using the license-manager binary.
	 *
	 * @param licenseFilePath The path to the license file
	 * @returns A promise that resolves to true if the license is valid
	 * @throws Error if the license file is invalid, expired, or cannot be read
	 */
	async verifyLicenseFile(licenseFilePath: string): Promise<boolean> {
		if (!fs.existsSync(licenseFilePath)) {
			throw new Error(`License file not found: ${licenseFilePath}`);
		}

		// Execute verification command
		const result = await this.runCommand('verify', [licenseFilePath]);

		// Look for JSON data in the output
		const jsonStartIndex = result.indexOf('{');
		if (jsonStartIndex !== -1) {
			const jsonContent = result.slice(jsonStartIndex);
			const output = JSON.parse(jsonContent) as LicenseVerifyOutput;

			// Status validation
			const status = output.status?.toLowerCase() || '';
			const daysLeft = output['days-left'];

			// Handle known invalid states
			if (status === 'expired' || daysLeft <= 0 || daysLeft === undefined) {
				throw new Error('License has expired. Please contact your administrator to renew your license.');
			}

			// Only accept active or evaluation licenses
			if (status !== 'active' && status !== 'evaluation') {
				throw new Error(`Invalid license status: ${output.status}`);
			}

			// License is valid
			const daysLeftMsg = daysLeft !== undefined ? `Days left: ${daysLeft}` : 'Days left: unknown';
			console.log(`Successfully validated Positron license (Status: ${output.status}, ${daysLeftMsg})`);
		} else {
			throw new Error('Failed to parse license verification output.');
		}

		return true;
	}
}


/**
 * Validates a Positron Server license file with the license-manager.
 *
 * @param installPath The root installation path of Positron
 * @param licenseFilePath The path to the license file
 * @returns A promise that resolves if the license is valid
 */
export async function validateWithManager(
	installPath: string,
	licenseFilePath: string,
): Promise<boolean> {
	const licenseManagerPath = findLicenseManagerPath(installPath);
	const licenseManager = new LicenseManager(licenseManagerPath);

	return await licenseManager.verifyLicenseFile(licenseFilePath);
}


/**
 * Gets the platform-specific subdirectory for the license-manager binary.
 * @returns The platform subdirectory path
 */
function getPlatformSubdir(): string {
	const platform = os.platform();
	if (platform === 'linux') {
		const arch = os.arch();
		// Map Node.js arch names to the directory names used by the build
		const archMap: Record<string, string> = {
			'x64': 'x86_64',
			'arm64': 'aarch64',
		};
		const archDir = archMap[arch] || arch;
		return path.join('linux', archDir);
	}
	// No other platforms are currently supported
	throw new Error(`Platform not supported: ${platform}`);
}

/**
 * Locates the license-manager binary relative to the Positron installation.
 * @param installPath The root installation path of Positron
 * @returns The absolute path to the license-manager binary
 */
function findLicenseManagerPath(installPath: string): string {
	const platformSubdir = getPlatformSubdir();
	const licenseManagerPath = path.join(installPath, 'resources', 'activation', platformSubdir, 'license-manager');

	if (!fs.existsSync(licenseManagerPath)) {
		throw new Error(`License manager binary not found at: ${licenseManagerPath}`);
	}

	try {
		fs.accessSync(licenseManagerPath, fs.constants.X_OK);
	} catch {
		throw new Error(`License manager binary is not executable: ${licenseManagerPath}`);
	}

	return licenseManagerPath;
}
