/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ServerParsedArgs } from 'vs/server/node/serverEnvironmentService';
import * as fs from 'fs';
import * as path from 'vs/base/common/path';
import * as crypto from 'crypto';

/**
 * A license key.
 */
interface LicenseKey {
	connection_token: string;
	timestamp: string;
	signature: string;
}

/**
 * A RSA-4096 public key used to verify license keys.
 */

const PublicKey = `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA1z/rsyUtRNo6IpJav8GZ
xSK5MLJ06KVALKdsIHuFriArKu0LZmO8E6uiT+YfJHOGLDqxIAoXs/3uMsKhQjKQ
NBfY+1iIH1PQ+okuKF54jc0LMaBg0t3xyub5YDZ3Z4gLYzmiKzJxndUZxJoU31Sf
7uAzZ61uKhs/8mQoiStr/IeLpFbVZ1STecHCFXpWLsl3ccw/HzfbmizyuTNYjwHN
5rJyBf2gEKure+BOYrGL7CMcWzgDmApnroA3Gk/k4atRdVZ27BvpddljCdHJospE
+zepasKVhGDQnz8gpHA1cAIo+r/o8i8gM1dcLHvp5lUmuaaQQjRkin2Edw0Z/rDL
wLI1cjS6OIGq+tJ32cyvi3U+AwUnQ33+TsG1Si5g9txge8L7eGyfBUc3EL+tgo5p
1R3nfIDAtkqGcbmI+dWOwQiOfaUTghS+YoF7Dyk5oNP+faOsHl6uc8SWQ65ZhVBf
vAb1iFBg5jrsvhZzzZbIah1XHYAT+X43WaExwme18pzBAgMBAAE=
-----END PUBLIC KEY-----`;

export async function validateLicenseKey(connectionToken: string, args: ServerParsedArgs): Promise<boolean> {

	// Check the command-line arguments for a license key.
	if (args['license-key']) {
		console.log('Checking Positron license key from the --license-key argument.');
		return validateLicense(connectionToken, args['license-key']);
	}

	// Check to see if a license key file is provided as a command-line
	// argument.
	if (args['license-key-file']) {
		console.log('Checking Positron license key from the file in the --license-key-file argument.');
		return validateLicenseFile(connectionToken, args['license-key-file']);
	}

	// Check the POSITRON_LICENSE_KEY environment variable.
	if (process.env.POSITRON_LICENSE_KEY) {
		console.log('Checking Positron license key from the POSITRON_LICENSE_KEY environment variable.');
		return validateLicense(connectionToken, process.env.POSITRON_LICENSE_KEY);
	}

	// Check the POSITRON_LICENSE_KEY_FILE environment variable.
	if (process.env.POSITRON_LICENSE_KEY_FILE) {
		console.log('Checking Positron license key from the file in the POSITRON_LICENSE_KEY_FILE environment variable.');
		return validateLicenseFile(connectionToken, process.env.POSITRON_LICENSE_KEY_FILE);
	}

	// If none of these were specified, check the user data directory for a
	// license key file. It is expected to live alongside the connection token.
	if (args['user-data-dir']) {
		const storageLocation = path.join(args['user-data-dir'], 'license-key');
		if (fs.existsSync(storageLocation)) {
			return validateLicenseFile(connectionToken, storageLocation);
		}
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

/**
 * Validates a license key.
 *
 * @param connectionToken The connection token.
 * @param license The license key.
 * @returns A promise that resolves to true if the license key is valid, or false if it is not.
 */
export async function validateLicense(connectionToken: string, license: string): Promise<boolean> {
	// Parse the license key.
	let licenseKey: LicenseKey;
	try {
		licenseKey = JSON.parse(license);
	} catch (e) {
		console.error('Error parsing license key: ', license);
		console.error(e);
		return false;
	}

	// Validate fields.
	if (!licenseKey.connection_token || !licenseKey.timestamp || !licenseKey.signature) {
		console.error('Invalid license key (missing fields): ', license);
		return false;
	}

	// Ensure that the license key is for the correct connection token.
	if (licenseKey.connection_token !== connectionToken) {
		console.error('Invalid license key; key is for token ', licenseKey.connection_token, ' but expected ', connectionToken);
		return false;
	}

	// Ensure that the time stamps do not differ by more than 5 minutes.
	const now = new Date();
	const timestamp = new Date(licenseKey.timestamp);
	if (Math.abs(now.getTime() - timestamp.getTime()) > 5 * 60 * 1000) {
		console.error('Invalid license key; timestamp does not match current time: ', licenseKey.timestamp);
		return false;
	}

	// Parse the public key.
	let publicKey: crypto.KeyObject;
	try {
		publicKey = crypto.createPublicKey({
			key: PublicKey,
			format: 'pem',
		});
	} catch (e) {
		console.error('Error parsing public key: ', e);
		return false;
	}

	// Verify the signature.
	const verifier = crypto.createVerify('sha256');
	verifier.update(licenseKey.connection_token + licenseKey.timestamp);
	const signature = Buffer.from(licenseKey.signature, 'base64');
	if (!verifier.verify(publicKey, signature)) {
		console.error('Invalid license key; signature is invalid: ', licenseKey.signature);
		return false;
	}

	console.log('Successfully validated Positron license key.');
	return true;
}
