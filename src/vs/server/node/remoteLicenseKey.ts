/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServerParsedArgs } from './serverEnvironmentService.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from '../../base/common/path.js';
import * as crypto from 'crypto';
import { FileAccess } from '../../base/common/network.js';
import { LicenseManager } from './licenseManager.js';
import { activateWithManager, verifyLocalLicense } from './localLicense.js';

/**
 * The result of validating a license.
 */
export interface ILicenseValidationResult {
	/** Whether the license is valid. */
	valid: boolean;
	/** The licensee name, if validation was successful. */
	licensee?: string;
	/** The issuer name, if validation was successful. */
	issuer?: string;
	/**
	 * Whether this license grants Positron's Education License Rider terms (drives the
	 * academic license banner and P3M telemetry). True for licenses validated from a raw
	 * license file, which is every deployment that is neither Posit Workbench (signed
	 * token, always false) nor the AWS license manager (left undefined, i.e. falsy).
	 * Note for Positron Server Pro: this license miust carry its own signal,
	 * or it will inherit `academic` as true
	 */
	academic?: boolean;
	/**
	 * A short, stable hash of the license file that licensed this deployment, reported to
	 * P3M as `positron-license-hash` so Posit can count session starts per license it
	 * issued. Computed by `hashLicenseContents` in `localLicense.ts` and carried up
	 * through the raw-license-file paths; a signed Workbench token is per-connection and
	 * the AWS license manager exposes no key material, so neither of those sets it.
	 */
	licenseHash?: string;
}

/**
 * This file validates Positron license keys. Positron requires a license key to
 * be provided in order to run in a hosted or managed environment. Raw .lic license
 * files are also accepted and are validated with the bundled license-manager binary.
 *
 * Positron license keys are JSON objects naming the connection token, issuer,
 * licensee, timestamp, and a PKCS1 v1.5 cryptographic signature of all of the
 * above.
 *
 * The signature is verified using an embedded public key.
 */

/**
 * The JSON data structure representing a license key.
 */
interface LicenseKey {
	/** The connection token associated with the license. */
	connection_token: string;

	/**
	 * The name of the entity that issued the license; usually the hosted
	 * environment.
	 */
	issuer: string;

	/**
	 * The name of the entity to which Positron is licensed, such as an individual
	 * or a company.
	 */
	licensee: string;

	/** The timestamp at which the license was issued. */
	timestamp: string;

	/**
	 * A PKCS1 v1.5 cryptographic signature of the token and timestamp from a
	 * valid Positron license issuing agent.
	 */
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

/**
 * Validates a license key. If any errors are encountered, they are logged to
 * the console.
 *
 * For flexibility in hosting, there are a number of ways to provide a license key:
 * - As a command-line argument with the --license-key flag.
 * - As a file path with the --license-key-file flag.
 * - As an environment variable named POSITRON_LICENSE_KEY.
 * - As a file path in an environment variable named POSITRON_LICENSE_KEY_FILE.
 * - As a .lic file next to the bundled license-manager binary.
 *
 * A provided license that does not validate falls back to the local .lic file, so
 * an environment that still injects retired verifier-minted tokens keeps working
 * off its license file.
 *
 * @param connectionToken The token to validate the license key against.
 * @param args The parsed command-line arguments.
 * @param verifyLocal Checks for a .lic next to the bundled license-manager binary.
 * Test-only, like `validateLicense`'s `publicKeys`.
 * @returns A promise that resolves to the license validation result.
 */
export async function validateLicenseKey(connectionToken: string, args: ServerParsedArgs, verifyLocal: typeof verifyLocalLicense = verifyLocalLicense): Promise<ILicenseValidationResult> {

	if (isRemoteLicenseManagerMode()) {
		console.log('Acquiring a Positron license through the license manager named by POSITRON_LICENSE_MANAGER_PATH.');
		return validateWithLicenseManager(process.env.POSITRON_LICENSE_MANAGER_PATH!);
	}

	// Check the provided license sources in order.
	let provided: ILicenseValidationResult | undefined;
	if (args['license-key']) {
		console.log('Checking Positron license key from the --license-key argument.');
		provided = await validateLicense(connectionToken, args['license-key']);
	} else if (args['license-key-file']) {
		console.log('Checking Positron license key from the file in the --license-key-file argument.');
		provided = await validateLicenseFile(connectionToken, args['license-key-file']);
	} else if (process.env.POSITRON_LICENSE_KEY) {
		console.log('Checking Positron license key from the POSITRON_LICENSE_KEY environment variable.');
		provided = await validateLicense(connectionToken, process.env.POSITRON_LICENSE_KEY);
	} else if (process.env.POSITRON_LICENSE_KEY_FILE) {
		console.log('Checking Positron license key from the file in the POSITRON_LICENSE_KEY_FILE environment variable.');
		provided = await validateLicenseFile(connectionToken, process.env.POSITRON_LICENSE_KEY_FILE);
	} else if (args['user-data-dir']) {
		// If none of these were specified, check the user data directory for a
		// license key file. It is expected to live alongside the connection token.
		const storageLocation = path.join(args['user-data-dir'], 'license-key');
		if (fs.existsSync(storageLocation)) {
			provided = await validateLicenseFile(connectionToken, storageLocation);
		}
	}

	if (provided?.valid) {
		return provided;
	}

	// No license was provided, or the provided one did not validate (for example a
	// token minted by a retired jupyter-positron-verifier). Look for a .lic next to
	// the license-manager binary; file-based licenses mark the deployment academic.
	// A license file that exists but does not verify (expired, tampered with) throws
	// rather than returning; hold onto the reason so the failure below can name it.
	let localError: unknown;
	try {
		const installPath = path.join(FileAccess.asFileUri('').fsPath, '..');
		const localResult = await verifyLocal(installPath);
		if (localResult?.valid) {
			if (provided) {
				console.log('The provided license key did not validate; using the license file next to the license-manager binary instead.');
			} else {
				console.log('Verified license from license-manager directory.');
			}
			return { ...localResult, academic: true };
		}
	} catch (e) {
		localError = e;
	}

	if (localError) {
		console.error('The license file next to the license-manager binary was rejected: ', localError);
	}

	if (provided) {
		// The provided license failed and there is no usable local license; the
		// failure was already logged by the validation path above.
		return provided;
	}

	if (localError) {
		// A license file was found and rejected. Saying "no license key provided" here
		// would send operators looking for a missing license instead of a bad one.
		return { valid: false };
	}

	// We need at least one license key to proceed.
	console.error('No license key provided. A license key is required to use Positron in a hosted environment. Provide a license key with the --license-key or --license-key-file command-line arguments, or set the POSITRON_LICENSE_KEY or POSITRON_LICENSE_KEY_FILE environment variables.');

	return { valid: false };
}

/**
 * Validates a license file. Signed JSON license tokens are verified in-process; raw
 * RSTUDIO/Posit license files are activated and verified with the bundled
 * license-manager binary and mark the deployment academic.
 *
 * @param connectionToken The connection token.
 * @param licenseFile The path to the license file.
 * @param activate Activates a raw license file with the license-manager binary.
 * Test-only, like `validateLicense`'s `publicKeys`.
 * @returns The license validation result.
 */
export async function validateLicenseFile(connectionToken: string, licenseFile: string, activate: typeof activateWithManager = activateWithManager): Promise<ILicenseValidationResult> {
	if (!fs.existsSync(licenseFile)) {
		console.error('License file does not exist: ', licenseFile);
		return { valid: false };
	}
	// Read the contents of the license file into a string.
	try {
		const contents = fs.readFileSync(licenseFile, 'utf8');
		const trimmedContents = contents.trim();
		if (trimmedContents.startsWith('{')) {
			// A signed JSON license token, minted by Posit Workbench.
			return validateLicense(connectionToken, contents);
		} else if (trimmedContents.startsWith('-----BEGIN RSTUDIO LICENSE-----')) {
			// A raw license file; activate and verify it with the license-manager
			// binary. File-based licenses mark the deployment academic; see
			// ILicenseValidationResult.academic.
			const installPath = path.join(FileAccess.asFileUri('').fsPath, '..');
			const result = await activate(installPath, licenseFile);
			return result.valid ? { ...result, academic: true } : result;
		} else {
			console.error('Unrecognized license file format. Expected a JSON license key or an RSA license file.');
			return { valid: false };
		}
	} catch (e) {
		console.error('Error validating license file: ', licenseFile);
		console.error(e);
	}
	return { valid: false };
}

/**
 * Validates a license key.
 *
 * @param connectionToken The connection token.
 * @param license The license key.
 * @param publicKeys Keys to verify against. Test-only; production uses the built-in keys.
 * @returns A promise that resolves to the license validation result.
 */
export async function validateLicense(connectionToken: string, license: string, publicKeys?: readonly string[]): Promise<ILicenseValidationResult> {
	// Parse the license key JSON.
	let licenseKey: LicenseKey;
	try {
		licenseKey = JSON.parse(license);
	} catch (e) {
		console.error('Error parsing license key: ', license);
		console.error(e);
		return { valid: false };
	}

	// Validate fields.
	if (!licenseKey.connection_token || !licenseKey.timestamp || !licenseKey.signature) {
		console.error('Invalid license key (missing fields): ', license);
		return { valid: false };
	}

	// Ensure that the license key is for the correct connection token.
	if (licenseKey.connection_token !== connectionToken) {
		console.error('Invalid license key; key is for token ', licenseKey.connection_token, ' but expected ', connectionToken);
		return { valid: false };
	}

	// Ensure that the time stamps do not differ by more than 5 minutes.
	const now = new Date();
	const timestamp = new Date(licenseKey.timestamp);
	if (Math.abs(now.getTime() - timestamp.getTime()) > 5 * 60 * 1000) {
		console.error('Invalid license key; timestamp does not match current time: ', licenseKey.timestamp);
		return { valid: false };
	}

	// Try each supplied public key; accept the license if any key verifies.
	const keysToTry = publicKeys ?? [PublicKey];
	const signature = Buffer.from(licenseKey.signature, 'base64');
	let signatureValid = false;
	for (const keyPem of keysToTry) {
		if (!keyPem.trim()) {
			continue;
		}
		let key: crypto.KeyObject;
		try {
			key = crypto.createPublicKey({ key: keyPem, format: 'pem' });
		} catch (e) {
			// A configured key that won't parse is a deployment error, not a bad
			// token; warn so it is not silently mistaken for an invalid signature.
			console.warn('Skipping license public key that could not be parsed: ', e);
			continue;
		}
		try {
			const verifier = crypto.createVerify('sha256');
			verifier.update(licenseKey.connection_token);
			verifier.update(licenseKey.issuer);
			verifier.update(licenseKey.licensee);
			verifier.update(licenseKey.timestamp);
			if (verifier.verify(key, signature)) {
				signatureValid = true;
				break;
			}
		} catch {
			// Verification threw for this key; try next.
		}
	}

	if (!signatureValid) {
		console.error('Invalid license key; signature is invalid: ', licenseKey.signature);
		return { valid: false };
	}

	console.log('Successfully validated Positron license key.');
	return {
		valid: true,
		licensee: licenseKey.licensee,
		issuer: licenseKey.issuer,
		// Signed tokens are minted by Posit Workbench, which is never an academic
		// deployment. Academic status comes from the raw-license-file paths.
		academic: false,
	};
}

/**
 * Whether the server should get its license from a license manager client
 * rather than from a signed license key.
 */
export function isRemoteLicenseManagerMode(): boolean {
	return !!process.env.POSITRON_LICENSE_MANAGER_PATH;
}

/**
 * Acquires a license by running the license manager client.
 *
 * @param binaryPath Path to the license manager client binary.
 * @returns The license validation result.
 */
async function validateWithLicenseManager(binaryPath: string): Promise<ILicenseValidationResult> {
	// A missing binary is a permanent, unambiguous deployment error. Checking up
	// front avoids sitting through the whole startup timeout respawning it.
	if (!fs.existsSync(binaryPath)) {
		console.error('License manager binary does not exist: ', binaryPath);
		return { valid: false };
	}

	const manager = new LicenseManager({
		binaryPath,
		onUnlicensed: () => {
			console.error('Positron is no longer licensed: the license manager could not hold a lease. Shutting down.');
			shutdown(1);
		},
	});

	// Terminating the client is what checks the seat back in, and nothing else in
	// the server does it for us: the `DisposableStore` in `createServer` is never
	// disposed, and Node's default signal disposition kills the process without
	// running `exit` listeners. So own the signals here.
	//
	// SIGKILL cannot be trapped here, but the client covers that on its own.
	// The one gap is a kill that takes the client down;
	// the seat then stays checked out until LM expires the provisional lease.
	let shuttingDown = false;
	const shutdown = (code: number): void => {
		if (shuttingDown) {
			// The client retries while failing, and an orchestrator may follow
			// SIGTERM with more signals; only the first one gets to shut us down.
			return;
		}
		shuttingDown = true;
		manager.stop().finally(() => process.exit(code));
	};

	// Installed before the client is even up, because `start()` waits up to a
	// minute for the first lease: a signal in that window would otherwise take
	// the default disposition and orphan a client that has already checked a
	// seat out.
	for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
		process.on(signal, () => {
			console.log(`Received ${signal}; returning the Positron license before exiting.`);
			const signalNumber = os.constants.signals[signal];
			shutdown(typeof signalNumber === 'number' ? 128 + signalNumber : 1);
		});
	}

	// Last-ditch, for exits that do not come from a signal (an unhandled error,
	// or `process.exit` called elsewhere). A process `exit` handler cannot await,
	// so all this can do is signal the client and hope it outlives us.
	process.on('exit', () => manager.dispose());

	if (!await manager.start()) {
		await manager.stop();
		console.error('The license manager did not report an activated license. Positron requires a license to run in a hosted environment.');
		return { valid: false };
	}

	return { valid: true };
}
