/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServerParsedArgs } from './serverEnvironmentService.js';
import * as fs from 'fs';
import * as path from '../../base/common/path.js';
import * as crypto from 'crypto';
import { LicenseManagerSupervisor } from './licenseManagerSupervisor.js';
import { LicenseStateMachine } from './licenseManagerState.js';

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
}

/**
 * This file validates Positron license keys. Positron requires a license key to
 * be provided in order to run in a hosted or managed environment.
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
 * A RSA-4096 public key used to verify license keys in Positron Server deployments
 */
const OrchestratorPublicKey = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAvL/qcnvIj+A7cXhUgism
MYfMzg6wrPgVOp3AezejarPGF+t9qwX1BRQZT176PLoujmZsD92wwh9yEK31TnVD
YENhtUymnNLvt5UbMoWI+dlttruTOYvoiBMUMajPqTF3jr0TE39YhLgc5fKidvLR
ZX4u0DQ0YVaJqfV7SUUAp9j6APtPuiP4SsJxIjlZo0Hvw+EZ5Y6TmgwfHhAwEBoP
5L9CwVjRAg34HP5wGl/znipXb3drMyUgpVuhyN+GrCXz30GXbWJcfoVw7y7G46Z4
En2Z/2Rs9P4wd6FeybSNOceit+5mnI5amvpaDrCSq1BnOm6NemdoNMYEuUI+0WSJ
2eYAI2x36wXFE+6zPkqZYEuFxN4L8xvZvu/LYBd1qyLjSEN9yoLekRzAAa1n222n
JKiTum02wdrvcjnBHZyB+OVLAySeM7JElh79A6OYe32ENSXvA3ZT+vUGbsptdggq
NjfOoqWxWVO3L8Gvx+0SjiczLt8c9Wp9dW7xiiAO6CMgy8wgnQircW00ZjadYPbI
J96J0myarwU9s46B9SbyWKzcTpEvHgD47/rRcMx64PlmtS6hxgIdyIKNFjWrGt5g
5AzUF63cLtv+he4d4CtfPo9TCbqLbaUop0g/3aqPAOAz/7wPLPnzURJGfiUYB/gx
jv4RUEuRUo3aePrbcc3Wfl8CAwEAAQ==
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
 *
 * @param connectionToken The token to validate the license key against.
 * @param args The parsed command-line arguments.
 * @returns A promise that resolves to the license validation result.
 */
export async function validateLicenseKey(connectionToken: string, args: ServerParsedArgs): Promise<ILicenseValidationResult> {

	// Remote license manager mode takes precedence over every key-based source.
	// In this mode the license is held by a supervised client process rather
	// than proven by a signed token, so a stale key in the environment must not
	// win over it.
	if (isRemoteLicenseManagerMode()) {
		console.log('Acquiring a Positron license through the license manager named by POSITRON_LICENSE_MANAGER_PATH.');
		const session = startRemoteLicenseManager({
			binaryPath: process.env.POSITRON_LICENSE_MANAGER_PATH!,
		});
		activeLicenseManagerSession = session;
		return session.validation;
	}

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

	// We need at least one signed license token to proceed. There is no fallback
	// to a raw license file: if no signed token is provided, validation fails closed.
	console.error('No license key provided. A signed license token is required to use Positron in a hosted environment. Provide one with the --license-key or --license-key-file command-line arguments, or set the POSITRON_LICENSE_KEY or POSITRON_LICENSE_KEY_FILE environment variables.');

	return { valid: false };
}

/**
 * Validates a license file. The file must contain a signed JSON license token;
 * raw license files are not accepted.
 *
 * @param connectionToken The connection token.
 * @param licenseFile The path to the license file.
 * @returns The license validation result.
 */
export async function validateLicenseFile(connectionToken: string, licenseFile: string): Promise<ILicenseValidationResult> {
	if (!fs.existsSync(licenseFile)) {
		console.error('License file does not exist: ', licenseFile);
		return { valid: false };
	}
	// Read the contents of the license file into a string.
	try {
		const contents = fs.readFileSync(licenseFile, 'utf8');
		// Only signed JSON license tokens are accepted; raw license files are not.
		if (contents.trim().startsWith('{')) {
			return validateLicense(connectionToken, contents);
		}
		console.error('Unrecognized license file format. Expected a signed JSON license token.');
		return { valid: false };
	} catch (e) {
		console.error('Error reading license file: ', licenseFile);
		console.error(e);
	}
	return { valid: false };
}

/**
 * Validates a license key.
 *
 * @param connectionToken The connection token.
 * @param license The license key.
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
	const keysToTry = publicKeys ?? [PublicKey, OrchestratorPublicKey];
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
		issuer: licenseKey.issuer
	};
}

/**
 * Remote license manager mode.
 *
 * In hosted environments such as SageMaker there is no signed license token to
 * present. Instead the server runs a licensing client that checks a license out
 * of a vendor's license service for as long as the server is running, and the
 * server's licensed state follows what that client reports.
 */

/** A running license manager session. */
export interface ILicenseManagerSession {
	/** Resolves once the license is confirmed, or the startup wait times out. */
	readonly validation: Promise<ILicenseValidationResult>;
	/** Whether the client process is still supervised. */
	readonly isRunning: boolean;
	/** Stops the client, giving it the chance to check the license back in. */
	stop(): Promise<void>;
}

/** Options for {@link startRemoteLicenseManager}. */
export interface ILicenseManagerModeOptions {
	/** Path to the license manager client binary. */
	binaryPath: string;
	/** Arguments for the client; defaults to the lease acquisition subcommand. */
	args?: string[];
	/** Environment for the client; defaults to this process's environment. */
	env?: NodeJS.ProcessEnv;
	/** How long to wait for the first successful checkout. */
	startupTimeoutMs?: number;
	/** How long a lost license is tolerated before enforcement. */
	graceMs?: number;
	/** Delay before respawning a client that exited. */
	restartDelayMs?: number;
	/** What to do when the license is lost for longer than the grace period. */
	onUnlicensed?: () => void;
}

/** The session started by validateLicenseKey, so shutdown can stop it. */
let activeLicenseManagerSession: ILicenseManagerSession | undefined;

/**
 * Whether the server should get its license from a license manager client
 * rather than from a signed license key.
 */
export function isRemoteLicenseManagerMode(): boolean {
	return !!process.env.POSITRON_LICENSE_MANAGER_PATH;
}

/**
 * Stops the license manager started by {@link validateLicenseKey}, if any.
 *
 * Called from the server's signal handling on shutdown. Without it the license
 * stays checked out until its lease expires, which blocks the next server that
 * needs that seat. Resolves immediately when this mode is not in use.
 */
export async function stopRemoteLicenseManager(): Promise<void> {
	const session = activeLicenseManagerSession;
	activeLicenseManagerSession = undefined;
	await session?.stop();
}

/**
 * Starts and supervises the license manager client.
 *
 * @param options Client location and licensing policy.
 * @returns A handle to the running session.
 */
export function startRemoteLicenseManager(options: ILicenseManagerModeOptions): ILicenseManagerSession {
	const state = new LicenseStateMachine({
		graceMs: options.graceMs,
		startupTimeoutMs: options.startupTimeoutMs,
	});

	const supervisor = new LicenseManagerSupervisor({
		binaryPath: options.binaryPath,
		args: options.args,
		env: options.env,
		restartDelayMs: options.restartDelayMs,
		onMessage: m => state.onMessage(m),
		onChildDown: () => state.onChildDown(),
	});

	let running = true;

	// Enforcement is deliberately the same fail-closed outcome as a missing
	// license key at startup: the server does not keep running unlicensed. The
	// grace period in the state machine is what keeps a brief outage from
	// ending a user's session.
	const onUnlicensed = options.onUnlicensed ?? (() => {
		console.error('Positron is no longer licensed: the license manager could not hold a license. Shutting down.');
		process.exit(1);
	});

	state.onStateChange(next => {
		// A stopped session is expected to lose its license: stop() kills the
		// client, which looks exactly like a crash to the state machine. Without
		// this guard, shutting the server down would trigger enforcement.
		if (!running) {
			return;
		}
		if (next === 'unlicensed') {
			onUnlicensed();
		}
	});

	supervisor.start();

	const stop = async (): Promise<void> => {
		if (!running) {
			return;
		}
		running = false;
		await supervisor.stop();
	};

	const validation = state.awaitStartup().then((licensed): ILicenseValidationResult => {
		if (!licensed) {
			console.error('The license manager did not report an activated license. Positron requires a license to run in a hosted environment.');
			return { valid: false };
		}
		console.log('Successfully acquired a Positron license from the license manager.');
		return { valid: true };
	});

	return {
		validation,
		get isRunning() { return running; },
		stop,
	};
}
