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
	signature?: string; // Added optional signature property
}

/**
 * The validated license information.
 */
export interface ValidatedLicense {
	licensee: string;
	expiration: Date;
	productName: string;
}


/**
 * Wrapper for executing license-manager binary commands.
 */
class LicenseCommand {
	constructor(private readonly licenseManagerPath: string) { }

	/**
	 * Runs a license-manager command and returns the stdout as a string.
	 * @param command The command to run (e.g., 'verify')
	 * @param args Optional arguments to pass to the command
	 * @returns The stdout from the command
	 */
	async runLicenseCommand(command: string, args: string[] = []): Promise<string> {
		const { stdout } = await execFileAsync(
			this.licenseManagerPath,
			[command, ...args],
			{ maxBuffer: 1024 * 1024, timeout: 10000 }
		);
		return stdout;
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
	// Locate the license-manager binary
	const licenseManagerPath = findLicenseManagerPath(installPath);
	console.log('Checking Positron license from the POSITRON_LICENSE_FILE environment variable.');
	return validateLicenseFile(licenseFilePath, licenseManagerPath);
}

/**
 * Validates a license file using the license-manager binary.
 *
 * @param licenseFilePath The path to the license file
 * @param licenseManagerPath The path to the license-manager binary
 * @returns A promise that resolves to the validated license information
 * @throws Error if the license file is invalid, expired, or cannot be read
 */
async function validateLicenseFile(
	licenseFilePath: string,
	licenseManagerPath: string
): Promise<boolean> {
	if (!fs.existsSync(licenseFilePath)) {
		throw new Error(`License file not found: ${licenseFilePath}`);
	}

	const licenseCommand = new LicenseCommand(licenseManagerPath);

	const result = await licenseCommand.runLicenseCommand('verify', [licenseFilePath]);

	// Extract the signature and JSON content
	const jsonStartIndex = result.indexOf('{');
	if (jsonStartIndex === -1) {
		throw new Error(`License validation failed: No JSON content found in output. Raw output: ${result}`);
	}

	const signature = result.slice(0, jsonStartIndex).trim();
	const jsonContent = result.slice(jsonStartIndex);
	const output = JSON.parse(jsonContent) as LicenseVerifyOutput;
	output['signature'] = signature; // Attach the signature to the output in case we need it later?

	// Validate the output structure
	if (!output.status || output['days-left'] === undefined) {
		throw new Error('Invalid license verification response: missing required fields');
	}

	// Check the license status - only 'active' and 'evaluation' are valid
	const validStatuses = ['active', 'evaluation'];
	if (!validStatuses.includes(output.status.toLowerCase())) {
		throw new Error(`Invalid license status: ${output.status}`);
	}

	// Check if the license has days left
	if (output['days-left'] <= 0) {
		throw new Error(
			`License has expired. Days remaining: ${output['days-left']}. ` +
			'Please contact your administrator to renew your license.'
		);
	}

	console.log(`Successfully validated Positron license (Status: ${output.status}, Days left: ${output['days-left']})`);

	return true;
}

/**
 * Locates the license-manager binary relative to the Positron installation.
 * @param installPath The root installation path of Positron
 * @returns The absolute path to the license-manager binary
 */
function findLicenseManagerPath(installPath: string): string {

	const licenseManagerPath = path.join(installPath, 'resources', 'activation', os.platform(), 'license-manager');

	if (!fs.existsSync(licenseManagerPath)) {
		throw new Error(`License manager binary not found at: ${licenseManagerPath}`);
	}

	// Verify it's executable
	try {
		fs.accessSync(licenseManagerPath, fs.constants.X_OK);
	} catch {
		throw new Error(`License manager binary is not executable: ${licenseManagerPath}`);
	}

	return licenseManagerPath;
}
