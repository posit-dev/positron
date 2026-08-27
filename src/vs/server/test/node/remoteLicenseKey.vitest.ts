/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from '../../../base/common/path.js';
import { validateLicense, validateLicenseFile, validateLicenseKey } from '../../node/remoteLicenseKey.js';
import type { ServerParsedArgs } from '../../node/serverEnvironmentService.js';

// remoteLicenseKey.ts locates the license-manager binary with FileAccess.asFileUri(''), which
// requires globalThis._VSCODE_FILE_ROOT. That's normally set by a bootstrap entry point (see
// agentHostServerMain.ts), which this plain Vitest run doesn't go through -- set it ourselves.
globalThis._VSCODE_FILE_ROOT = new URL('../../../../..', import.meta.url).pathname;

function createServerArgs(): ServerParsedArgs {
	return {
		'accept-server-license-terms': false,
		workspace: '',
		folder: '',
		help: false,
		version: false,
		compatibility: '',
		_: [],
	};
}

describe('validateLicense', () => {
	// Generate a 2048-bit test key pair once for the suite (sync, ~100ms).
	const { privateKey: testPrivKey, publicKey: testPubKeyPem } = crypto.generateKeyPairSync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	});

	/** Signs a license payload with the given private key and returns the JSON string. */
	function mintLicense(
		connectionToken: string,
		issuer: string,
		licensee: string,
		timestamp: string,
		privKey: crypto.KeyLike = testPrivKey,
	): string {
		// connection_token + issuer + licensee + timestamp are all signed, in this
		// order, matching the field update order in remoteLicenseKey.ts.
		const signer = crypto.createSign('sha256');
		signer.update(connectionToken);
		signer.update(issuer);
		signer.update(licensee);
		signer.update(timestamp);
		const signature = signer.sign(privKey).toString('base64');
		return JSON.stringify({ connection_token: connectionToken, issuer, licensee, timestamp, signature });
	}

	it('validates a correctly signed token', async () => {
		const token = 'test-connection-token';
		const timestamp = new Date().toISOString();
		const license = mintLicense(token, 'Test Hub', 'Test Corp', timestamp);

		const result = await validateLicense(token, license, [testPubKeyPem]);

		expect(result.valid).toBe(true);
		expect(result.issuer).toBe('Test Hub');
		expect(result.licensee).toBe('Test Corp');
	});

	it('validates a token with empty issuer and licensee', async () => {
		// Signed tokens may legitimately carry empty issuer/licensee (e.g. dev
		// tokens, or an issuer that omits them). The empty strings are still part
		// of the signed payload, so the token must validate rather than be
		// rejected as "missing fields".
		const token = 'test-token-empty-fields';
		const timestamp = new Date().toISOString();
		const license = mintLicense(token, '', '', timestamp);

		const result = await validateLicense(token, license, [testPubKeyPem]);

		expect(result.valid).toBe(true);
	});

	it('rejects a token with a wrong connection_token', async () => {
		const timestamp = new Date().toISOString();
		const license = mintLicense('right-token', 'Test Hub', 'Test Corp', timestamp);

		const result = await validateLicense('wrong-token', license, [testPubKeyPem]);

		expect(result.valid).toBe(false);
	});

	it('rejects a token with a stale timestamp', async () => {
		const token = 'test-token-stale';
		const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
		const license = mintLicense(token, 'Test Hub', 'Test Corp', staleTimestamp);

		const result = await validateLicense(token, license, [testPubKeyPem]);

		expect(result.valid).toBe(false);
	});

	it('rejects a token signed by an unknown key', async () => {
		const { privateKey: unknownPrivKey } = crypto.generateKeyPairSync('rsa', {
			modulusLength: 2048,
			publicKeyEncoding: { type: 'spki', format: 'pem' },
			privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		});

		const token = 'test-token-badkey';
		const timestamp = new Date().toISOString();
		const license = mintLicense(token, 'Test Hub', 'Test Corp', timestamp, unknownPrivKey);

		const result = await validateLicense(token, license, [testPubKeyPem]);

		expect(result.valid).toBe(false);
	});

	it('marks a signed token not academic and gives it no license hash', async () => {
		// A signed token is minted per connection, so hashing it would identify the
		// connection rather than a license Posit issued.
		const token = 'test-token-not-academic';
		const timestamp = new Date().toISOString();
		const license = mintLicense(token, 'Test Hub', 'Test Corp', timestamp);

		const result = await validateLicense(token, license, [testPubKeyPem]);

		expect({ valid: result.valid, academic: result.academic, licenseHash: result.licenseHash })
			.toEqual({ valid: true, academic: false, licenseHash: undefined });
	});

	it('rejects malformed JSON', async () => {
		const result = await validateLicense('token', 'not-valid-json{{{', [testPubKeyPem]);

		expect(result.valid).toBe(false);
	});

	it('rejects a license with missing required fields', async () => {
		const license = JSON.stringify({ connection_token: 'token', issuer: 'Hub' });

		const result = await validateLicense('token', license, [testPubKeyPem]);

		expect(result.valid).toBe(false);
	});

	it('rejects when no public keys are provided', async () => {
		const token = 'test-token-nokeys';
		const timestamp = new Date().toISOString();
		const license = mintLicense(token, 'Hub', 'Corp', timestamp);

		const result = await validateLicense(token, license, []);

		expect(result.valid).toBe(false);
	});

	it('falls back to the embedded keys when none are supplied', async () => {
		const token = 'test-token-default';
		const timestamp = new Date().toISOString();
		const license = mintLicense(token, 'Hub', 'Corp', timestamp);

		const result = await validateLicense(token, license);

		expect(result.valid).toBe(false);
	});
});

describe('validateLicenseFile', () => {
	function writeTempLicense(contents: string): string {
		const licPath = path.join(os.tmpdir(), `positron-test-${Date.now()}-${Math.random().toString(36).slice(2)}.lic`);
		fs.writeFileSync(licPath, contents);
		return licPath;
	}

	// The hash is computed where the verified file lives (localLicense.ts), so this path
	// only has to mark the deployment academic and pass the hash through untouched,
	// whether the license manager reported one or not.
	it.each([undefined, 'a1b2c3d4e5f60718'])(
		'marks a verified raw license file academic, carrying licenseHash %s',
		async licenseHash => {
			const licPath = writeTempLicense('-----BEGIN RSTUDIO LICENSE-----\nabc123\n-----END RSTUDIO LICENSE-----\n');
			try {
				const result = await validateLicenseFile('any-token', licPath, async () => ({ valid: true, licensee: 'Acme University', licenseHash }));
				expect(result).toEqual({ valid: true, licensee: 'Acme University', academic: true, licenseHash });
			} finally {
				fs.unlinkSync(licPath);
			}
		});

	it('does not mark a rejected raw license file academic', async () => {
		const licPath = writeTempLicense('-----BEGIN RSTUDIO LICENSE-----\nabc123\n-----END RSTUDIO LICENSE-----\n');
		try {
			const result = await validateLicenseFile('any-token', licPath, async () => ({ valid: false }));
			expect(result).toEqual({ valid: false });
		} finally {
			fs.unlinkSync(licPath);
		}
	});

	it('rejects an unrecognized license file format without invoking the license manager', async () => {
		const licPath = writeTempLicense('this is not a license\n');
		try {
			let activateCalled = false;
			const result = await validateLicenseFile('any-token', licPath, async () => {
				activateCalled = true;
				return { valid: true };
			});
			expect({ valid: result.valid, activateCalled }).toEqual({ valid: false, activateCalled: false });
		} finally {
			fs.unlinkSync(licPath);
		}
	});
});

describe('validateLicenseKey', () => {
	/** Runs fn with the license env vars cleared, restoring them afterwards. */
	async function withCleanLicenseEnv(fn: () => Promise<void>): Promise<void> {
		const saved: Record<string, string | undefined> = {};
		for (const name of ['POSITRON_LICENSE_KEY', 'POSITRON_LICENSE_KEY_FILE', 'POSITRON_LICENSE_MANAGER_PATH']) {
			saved[name] = process.env[name];
			delete process.env[name];
		}
		try {
			await fn();
		} finally {
			for (const [name, value] of Object.entries(saved)) {
				if (value === undefined) { delete process.env[name]; } else { process.env[name] = value; }
			}
		}
	}

	it('fails closed when no license is available anywhere', async () => {
		const prevKey = process.env.POSITRON_LICENSE_KEY;
		const prevFile = process.env.POSITRON_LICENSE_KEY_FILE;
		const prevManager = process.env.POSITRON_LICENSE_MANAGER_PATH;
		delete process.env.POSITRON_LICENSE_KEY;
		delete process.env.POSITRON_LICENSE_KEY_FILE;
		delete process.env.POSITRON_LICENSE_MANAGER_PATH;
		try {
			const args = createServerArgs();
			const result = await validateLicenseKey('some-token', args, async () => undefined);
			expect(result.valid).toBe(false);
		} finally {
			if (prevKey !== undefined) { process.env.POSITRON_LICENSE_KEY = prevKey; }
			if (prevFile !== undefined) { process.env.POSITRON_LICENSE_KEY_FILE = prevFile; }
			if (prevManager !== undefined) { process.env.POSITRON_LICENSE_MANAGER_PATH = prevManager; }
		}
	});

	it('takes the license manager path over a license key, and fails fast when the binary is missing', async () => {
		const prevKey = process.env.POSITRON_LICENSE_KEY;
		const prevManager = process.env.POSITRON_LICENSE_MANAGER_PATH;
		process.env.POSITRON_LICENSE_KEY = '{"connection_token":"some-token"}';
		process.env.POSITRON_LICENSE_MANAGER_PATH = '/nonexistent/license-manager-aws-sagemaker';
		try {
			const args = createServerArgs();
			const started = Date.now();
			const result = await validateLicenseKey('some-token', args);

			expect(result.valid).toBe(false);
			expect(Date.now() - started).toBeLessThan(1_000);
		} finally {
			if (prevKey === undefined) { delete process.env.POSITRON_LICENSE_KEY; } else { process.env.POSITRON_LICENSE_KEY = prevKey; }
			if (prevManager === undefined) { delete process.env.POSITRON_LICENSE_MANAGER_PATH; } else { process.env.POSITRON_LICENSE_MANAGER_PATH = prevManager; }
		}
	});

	it.each([undefined, 'a1b2c3d4e5f60718'])(
		'marks a local .lic license academic, carrying licenseHash %s',
		async licenseHash => {
			await withCleanLicenseEnv(async () => {
				const result = await validateLicenseKey('some-token', createServerArgs(), async () => ({ valid: true, licensee: 'Acme University', licenseHash }));
				expect(result).toEqual({ valid: true, licensee: 'Acme University', academic: true, licenseHash });
			});
		});

	it('falls back to the local .lic when the provided license does not validate', async () => {
		// A lingering jupyter-positron-verifier deployment injects a minted token
		// that is no longer accepted; the session must still license off the local
		// .lic and stay academic.
		await withCleanLicenseEnv(async () => {
			process.env.POSITRON_LICENSE_KEY = JSON.stringify({
				connection_token: 'some-token',
				issuer: 'JupyterHub',
				licensee: 'Acme University',
				timestamp: new Date().toISOString(),
				signature: 'bm90LWEtcmVhbC1zaWduYXR1cmU=',
			});
			const result = await validateLicenseKey('some-token', createServerArgs(), async () => ({ valid: true, licensee: 'Acme University' }));
			expect(result).toEqual({ valid: true, licensee: 'Acme University', academic: true });
		});
	});

	it('fails closed when the provided license is invalid and there is no local license', async () => {
		await withCleanLicenseEnv(async () => {
			process.env.POSITRON_LICENSE_KEY = 'not-valid-json{{{';
			const result = await validateLicenseKey('some-token', createServerArgs(), async () => undefined);
			expect(result.valid).toBe(false);
		});
	});

	it('names the reason a local license was rejected rather than claiming none was provided', async () => {
		// A .lic that exists but does not verify makes the license-manager throw. The
		// operator needs to hear that the license was rejected; "no license key provided"
		// would send them looking for a missing file instead of an expired one.
		await withCleanLicenseEnv(async () => {
			const errors: string[] = [];
			const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
				errors.push(args.map(String).join(' '));
			});
			try {
				const result = await validateLicenseKey('some-token', createServerArgs(), async () => {
					throw new Error('License has expired. Please renew your license.');
				});
				expect({
					valid: result.valid,
					namedTheRejection: errors.some(e => e.includes('License has expired')),
					claimedMissing: errors.some(e => e.includes('No license key provided')),
				}).toEqual({ valid: false, namedTheRejection: true, claimedMissing: false });
			} finally {
				spy.mockRestore();
			}
		});
	});
});
