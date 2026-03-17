/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from '../../base/common/path.js';
import type { ILicenseValidationResult } from './remoteLicenseKey.js';

const execFileAsync = promisify(execFile);

/**
 * License error codes from license-manager.
 */
const LicError = {
	OK: 0,
	FAIL: 1,
	TRIAL_EXPIRED: 2,
	VM: 3,
} as const;

/**
 * Grace period in days after license expiration.
 */
const GRACE_PERIOD_DAYS = 30;

/**
 * The JSON data structure returned by license-manager commands with --output=json.
 */
interface LicenseCommandResult {
	result: number;
	message?: string;
	status?: string;
	'days-left'?: number;
	'has-key'?: boolean;
	'has-trial'?: boolean;
	'license-file'?: string;
	licensee?: string;
	initialized?: boolean;
	expiration?: number;
}

/**
 * Wrapper for executing license-manager binary commands.
 */
class LicenseManager {
	constructor(private readonly licenseManagerPath: string) { }

	/**
	 * Runs a license-manager command and returns the stdout as a string.
	 */
	private async runCommand(command: string, args: string[] = []): Promise<string> {
		const licenseManagerDir = path.dirname(this.licenseManagerPath);
		const env = {
			...process.env,
			LD_LIBRARY_PATH: licenseManagerDir,
		};

		const { stdout, stderr } = await execFileAsync(
			this.licenseManagerPath,
			[command, ...args],
			{ maxBuffer: 1024 * 1024, timeout: 10000, env }
		);

		if (stderr && stderr.length > 0) {
			console.warn(`license-manager stderr: ${stderr}`);
		}

		return stdout;
	}

	/**
	 * Runs a command expecting JSON output.
	 */
	private async runJsonCommand(command: string, args: string[] = []): Promise<LicenseCommandResult> {
		try {
			const stdout = await this.runCommand(command, [...args, '--output=json']);
			return JSON.parse(stdout);
		} catch (error: any) {
			// license-manager may return non-zero exit with JSON in stdout
			if (error.stdout) {
				try {
					return JSON.parse(error.stdout);
				} catch {
					// fall through
				}
			}
			return {
				result: LicError.FAIL,
				message: error.message || 'Unknown error'
			};
		}
	}

	/**
	 * Check if license system is initialized.
	 */
	async getVerify(): Promise<LicenseCommandResult> {
		return this.runJsonCommand('get-verify');
	}

	/**
	 * Initialize the license system (required before activation).
	 */
	async initialize(): Promise<LicenseCommandResult> {
		return this.runJsonCommand('initialize', ['--userspace']);
	}

	/**
	 * Get current license status.
	 */
	async statusOffline(): Promise<LicenseCommandResult> {
		return this.runJsonCommand('status-offline');
	}

	/**
	 * Activate a license file - this INSTALLS the license into the system.
	 */
	async activateFile(licenseFilePath: string): Promise<LicenseCommandResult> {
		return this.runJsonCommand('activate-file', [licenseFilePath]);
	}

	/**
	 * Verify current license state (for periodic checks).
	 */
	async verify(): Promise<LicenseCommandResult> {
		return this.runJsonCommand('verify');
	}

	/**
	 * Full activation flow: initialize if needed, then activate the license file.
	 */
	async activateLicenseFile(licenseFilePath: string): Promise<ILicenseValidationResult> {
		if (!fs.existsSync(licenseFilePath)) {
			throw new Error(`License file not found: ${licenseFilePath}`);
		}

		// Step 1: Check if system is initialized
		const verifyResult = await this.getVerify();
		if (verifyResult.result === LicError.OK && !verifyResult.initialized) {
			// Step 2: Initialize if needed
			console.log('Initializing license system...');
			const initResult = await this.initialize();
			if (initResult.result !== LicError.OK &&
				initResult.result !== LicError.TRIAL_EXPIRED &&
				initResult.result !== LicError.VM) {
				throw new Error(`Failed to initialize license system: ${initResult.message || 'Unknown error'}`);
			}
		}

		// Step 3: Activate the license file
		console.log('Activating license file...');
		const result = await this.activateFile(licenseFilePath);

		if (result.result !== LicError.OK) {
			throw new Error(result.message || `Activation failed with code ${result.result}`);
		}

		const status = result.status?.toLowerCase() || '';
		const daysLeft = result['days-left'] ?? 0;

		// Handle expired licenses
		if (status === 'expired') {
			// Check grace period
			if (daysLeft < -GRACE_PERIOD_DAYS) {
				throw new Error('License has expired beyond the grace period. Please renew your license.');
			}
			console.warn(`License expired but within ${GRACE_PERIOD_DAYS}-day grace period.`);
		} else if (status !== 'activated' && status !== 'evaluation') {
			throw new Error(`Invalid license status: ${status}`);
		}

		const daysLeftMsg = daysLeft !== undefined ? `Days left: ${daysLeft}` : '';
		console.log(`Successfully activated Positron license (Status: ${status}${daysLeftMsg ? ', ' + daysLeftMsg : ''})`);

		return {
			valid: true,
			licensee: result.licensee
		};
	}

	/**
	 * Verify an already-activated license (read-only check).
	 */
	async verifyLicenseFile(licenseFilePath: string): Promise<ILicenseValidationResult> {
		if (!fs.existsSync(licenseFilePath)) {
			throw new Error(`License file not found: ${licenseFilePath}`);
		}

		const result = await this.statusOffline();

		if (result.result !== LicError.OK) {
			throw new Error(result.message || 'License verification failed');
		}

		const status = result.status?.toLowerCase() || '';
		const daysLeft = result['days-left'] ?? 0;

		if (status === 'expired' && daysLeft < -GRACE_PERIOD_DAYS) {
			throw new Error('License has expired. Please contact your administrator to renew your license.');
		}

		if (status !== 'activated' && status !== 'evaluation' && status !== 'expired') {
			throw new Error(`Invalid license status: ${status}`);
		}

		return {
			valid: true,
			licensee: result.licensee
		};
	}
}

/**
 * Activates and validates a Positron Server license file with the license-manager.
 * Use this for initial license setup.
 *
 * @param installPath The root installation path of Positron
 * @param licenseFilePath The path to the license file
 * @returns A promise that resolves to the license validation result
 */
export async function activateWithManager(
	installPath: string,
	licenseFilePath: string,
): Promise<ILicenseValidationResult> {
	const licenseManagerPath = findLicenseManagerPath(installPath);
	const licenseManager = new LicenseManager(licenseManagerPath);
	return licenseManager.activateLicenseFile(licenseFilePath);
}

/**
 * Validates an already-activated Positron Server license file with the license-manager.
 * Use this for periodic license checks after initial activation.
 *
 * @param installPath The root installation path of Positron
 * @param licenseFilePath The path to the license file
 * @returns A promise that resolves to the license validation result
 */
export async function validateWithManager(
	installPath: string,
	licenseFilePath: string,
): Promise<ILicenseValidationResult> {
	const licenseManagerPath = findLicenseManagerPath(installPath);
	const licenseManager = new LicenseManager(licenseManagerPath);
	return licenseManager.verifyLicenseFile(licenseFilePath);
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
