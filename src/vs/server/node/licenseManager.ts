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

function validatedResult(result: LicenseCommandResult): ILicenseValidationResult {
	const status = result.status?.toLowerCase() || '';
	if (status === 'expired') {
		throw new Error('License has expired. Please renew your license.');
	}
	if (status !== 'activated' && status !== 'evaluation') {
		throw new Error(`Invalid license result: ${JSON.stringify(result)}`);
	}
	return { valid: true, licensee: result.licensee };
}

// The `verify` command prefixes its JSON output with a signature hash line.
function extractJson(stdout: string): string {
	const jsonStart = stdout.indexOf('{');
	return jsonStart > 0 ? stdout.slice(jsonStart) : stdout;
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

			const jsonStr = extractJson(stdout);
			const parsed = JSON.parse(jsonStr);
			if (typeof parsed?.result !== 'number') {
				throw new Error(`Invalid license-manager response: ${stdout}`);
			}
			return parsed;
		} catch (error) {
			const execError = error as { stdout?: string; message?: string };
			if (execError.stdout) {
				try {
					const jsonStr = extractJson(execError.stdout);
					const parsed = JSON.parse(jsonStr);
					if (typeof parsed?.result === 'number') {
						return parsed;
					}
				} catch { /* fall through */ }
				throw new Error(`Invalid license-manager response: ${execError.stdout}`);
			}
			throw new Error(execError.message || 'Unknown error');
		}
	}

	async verify(): Promise<ILicenseValidationResult> {
		const result = await this.runJsonCommand('verify');
		if (result.result !== LicError.OK) {
			throw new Error(`License verification failed: ${result.message || `code ${result.result}`}`);
		}

		const validated = validatedResult(result);
		console.log(`Positron license verified: ${JSON.stringify(result)}`);
		return validated;
	}

	async activateLicenseFile(licenseFilePath: string): Promise<ILicenseValidationResult> {
		const licenseManagerDir = path.dirname(this.licenseManagerPath);

		// Check for a .lic file next to the license-manager binary first.
		const localLic = fs.readdirSync(licenseManagerDir).find(f => f.endsWith('.lic'));
		if (!localLic) {
			// No .lic next to the binary -- copy the provided file there.
			if (!fs.existsSync(licenseFilePath)) {
				throw new Error(`License file not found: ${licenseFilePath}`);
			}
			fs.copyFileSync(licenseFilePath, path.join(licenseManagerDir, path.basename(licenseFilePath)));
		}

		return this.verify();
	}
}

/**
 * Activates a Positron Server license file using the license-manager binary.
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
 * Checks for a .lic file next to the license-manager binary and verifies it.
 * Returns undefined if no .lic file is found or the binary doesn't exist.
 */
export async function verifyLocalLicense(
	installPath: string,
): Promise<ILicenseValidationResult | undefined> {
	let licenseManagerPath: string;
	try {
		licenseManagerPath = findLicenseManagerPath(installPath);
	} catch {
		return undefined;
	}

	const licenseManagerDir = path.dirname(licenseManagerPath);
	const localLic = fs.readdirSync(licenseManagerDir).find(f => f.endsWith('.lic'));
	if (!localLic) {
		return undefined;
	}

	const licenseManager = new LicenseManager(licenseManagerPath);
	return licenseManager.verify();
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
