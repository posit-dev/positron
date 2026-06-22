/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { validateLicense, validateLicenseKey } from '../../node/remoteLicenseKey.js';
import { ServerParsedArgs } from '../../node/serverEnvironmentService.js';

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
		// The minting service legitimately issues tokens with empty issuer/licensee
		// (e.g. dev mode, or a license-manager whose verify output omits issuer).
		// The empty strings are still part of the signed payload, so the token must
		// validate rather than be rejected as "missing fields".
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

	it('validates against a second key when the first fails', async () => {
		const { privateKey: orchestratorPrivKey, publicKey: orchestratorPubKeyPem } =
			crypto.generateKeyPairSync('rsa', {
				modulusLength: 2048,
				publicKeyEncoding: { type: 'spki', format: 'pem' },
				privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
			});

		const token = 'test-token-orchestrator';
		const timestamp = new Date().toISOString();
		const license = mintLicense(token, 'JupyterHub', 'Acme Corp', timestamp, orchestratorPrivKey);

		// testPubKeyPem fails, orchestratorPubKeyPem succeeds.
		const result = await validateLicense(token, license, [testPubKeyPem, orchestratorPubKeyPem]);

		expect(result.valid).toBe(true);
		expect(result.issuer).toBe('JupyterHub');
		expect(result.licensee).toBe('Acme Corp');
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
		// With no `publicKeys` argument, validation uses the embedded PublicKey /
		// OrchestratorPublicKey constants. A token signed by our test key matches
		// neither, so this exercises the default-key branch and must reject it. It
		// guards against the default array being accidentally emptied or dropped.
		const token = 'test-token-default';
		const timestamp = new Date().toISOString();
		const license = mintLicense(token, 'Hub', 'Corp', timestamp);

		const result = await validateLicense(token, license);

		expect(result.valid).toBe(false);
	});
});

describe('validateLicenseKey', () => {
	it('fails closed when no signed token is available (no raw-license fallback)', async () => {
		// With no --license-key args and no env-provided token, validation must fail
		// rather than fall back to reading a raw .lic from disk.
		const prevKey = process.env.POSITRON_LICENSE_KEY;
		const prevFile = process.env.POSITRON_LICENSE_KEY_FILE;
		delete process.env.POSITRON_LICENSE_KEY;
		delete process.env.POSITRON_LICENSE_KEY_FILE;
		try {
			// validateLicenseKey only reads the license-related args; an empty
			// object covers the no-token-provided case under test.
			const args = {} as ServerParsedArgs;
			const result = await validateLicenseKey('some-token', args);
			expect(result.valid).toBe(false);
		} finally {
			if (prevKey !== undefined) { process.env.POSITRON_LICENSE_KEY = prevKey; }
			if (prevFile !== undefined) { process.env.POSITRON_LICENSE_KEY_FILE = prevFile; }
		}
	});
});
