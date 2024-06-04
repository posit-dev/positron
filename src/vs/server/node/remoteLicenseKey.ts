/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ServerParsedArgs } from 'vs/server/node/serverEnvironmentService';
import * as fs from 'fs';
import * as path from 'vs/base/common/path';

export async function validateLicenseKey(connectionToken: string, args: ServerParsedArgs): Promise<boolean> {

	// Check the command-line arguments for a license key.
	if (args['license-key']) {
		return validateLicense(connectionToken, args['license-key']);
	}

	// Check to see if a license key file is provided as a command-line
	// argument.
	if (args['license-key-file']) {
		return validateLicenseFile(connectionToken, args['license-key-file']);
	}

	// Check the POSITRON_LICENSE_KEY environment variable.
	if (process.env.POSITRON_LICENSE_KEY) {
		return validateLicense(connectionToken, process.env.POSITRON_LICENSE_KEY);
	}

	// Check the POSITRON_LICENSE_KEY_FILE environment variable.
	if (process.env.POSITRON_LICENSE_KEY_FILE) {
		return validateLicenseFile(connectionToken, process.env.POSITRON_LICENSE_KEY_FILE);
	}

	// If none of these were specified, check the user data directory for a
	// license key. It is expected to live alongside the connection token.
	if (args['user-data-dir']) {
		const storageLocation = path.join(args['user-data-dir'], 'license-key');
		return validateLicenseFile(connectionToken, storageLocation);
	}

	console.error('No license key provided. A license key is required to use Positron in a hosted environment. Provide a license key with the --license-key or --license-key-file command-line arguments, or set the POSITRON_LICENSE_KEY or POSITRON_LICENSE_KEY_FILE environment variables.');

	return false;
}

export async function validateLicenseFile(connectionToken: string, licenseFile: string): Promise<boolean> {
	if (!fs.existsSync(licenseFile)) {
		console.error('License file does not exist: ', licenseFile);
		return false;
	}
	// Read the contents of the license file into a string.
	try {
		const contents = fs.readFileSync(licenseFile, 'utf8');
		return validateLicense(connectionToken, contents);
	} catch (e) {
		console.error('Error reading license file: ', licenseFile);
		console.error(e);
	}
	return false;
}

export async function validateLicense(connectionToken: string, license: string): Promise<boolean> {
	return true;
}
