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

const LicError = {
	OK: 0,
	FAIL: 1,
	TRIAL_EXPIRED: 2,
	VM: 3,
} as const;

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

function validateLicenseStatus(result: LicenseCommandResult): void {
	const status = result.status?.toLowerCase() || '';
	if (status === 'expired') {
		throw new Error('License has expired. Please renew your license.');
	}
	if (status !== 'activated' && status !== 'evaluation') {
		throw new Error(`Invalid license result: ${JSON.stringify(result)}`);
	}
}

/**
 * Wrapper for executing license-manager binary commands.
 */
class LicenseManager {
	constructor(private readonly licenseManagerPath: string) { }

	private async runJsonCommand(command: string, args: string[] = []): Promise<LicenseCommandResult> {
		const licenseManagerDir = path.dirname(this.licenseManagerPath);
		const env = {
			...process.env,
			LD_LIBRARY_PATH: licenseManagerDir,
		};

		try {
			const { stdout, stderr } = await execFileAsync(
				this.licenseManagerPath,
				[command, ...args, '--output=json'],
				{ maxBuffer: 1024 * 1024, timeout: 10000, env }
			);

			if (stderr && stderr.length > 0) {
				console.warn(`license-manager stderr: ${stderr}`);
			}

			const parsed = JSON.parse(stdout);
			if (!Object.values(LicError).includes(parsed?.result)) {
				throw new Error(`Invalid license-manager response: ${stdout}`);
			}
			return parsed;
		} catch (error) {
			const execError = error as { stdout?: string; message?: string };
			if (execError.stdout) {
				try {
					const parsed = JSON.parse(execError.stdout);
					if (Object.values(LicError).includes(parsed?.result)) {
						return parsed;
					}
				} catch { /* fall through */ }
				throw new Error(`Invalid license-manager response: ${execError.stdout}`);
			}
			throw new Error(execError.message || 'Unknown error');
		}
	}

	async activateLicenseFile(licenseFilePath: string): Promise<ILicenseValidationResult> {
		if (!fs.existsSync(licenseFilePath)) {
			throw new Error(`License file not found: ${licenseFilePath}`);
		}

		const verifyResult = await this.runJsonCommand('get-verify');
		if (verifyResult.result === LicError.OK && !verifyResult.initialized) {
			console.log('Initializing license system...');
			const initResult = await this.runJsonCommand('initialize', ['--userspace']);
			if (initResult.result !== LicError.OK &&
				initResult.result !== LicError.TRIAL_EXPIRED &&
				initResult.result !== LicError.VM) {
				throw new Error(`Failed to initialize license system: ${initResult.message || 'Unknown error'}`);
			}
		}

		console.log('Activating license file...');
		const result = await this.runJsonCommand('activate-file', [licenseFilePath]);

		if (result.result !== LicError.OK) {
			throw new Error(result.message || `Activation failed with code ${result.result}`);
		}

		validateLicenseStatus(result);

		console.log(`Successfully activated Positron license: ${JSON.stringify(result)}`);

		return {
			valid: true,
			licensee: result.licensee
		};
	}
}

/**
 * Activates a Positron Server license file using the license-manager binary.
 * This installs the license into the system.
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
