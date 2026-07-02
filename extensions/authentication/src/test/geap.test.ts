/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

/**
 * Snapshot/restore for env vars touched by the GEAP resolver.
 */
const GEAP_ENV_KEYS = [
	'GOOGLE_CLIENT_EMAIL',
	'GOOGLE_PRIVATE_KEY',
	'GOOGLE_PRIVATE_KEY_ID',
	'GOOGLE_APPLICATION_CREDENTIALS',
	'GOOGLE_VERTEX_PROJECT',
	'GOOGLE_VERTEX_LOCATION',
] as const;

/**
 * Default project/location used by tests that don't focus on the
 * project/location requirement. Set in the resolver suite's `setup` so
 * the JSON envelope carries valid values.
 */
const TEST_PROJECT = 'test-project';
const TEST_LOCATION = 'us-central1';

function snapshotEnv(): Record<string, string | undefined> {
	const snapshot: Record<string, string | undefined> = {};
	for (const key of GEAP_ENV_KEYS) {
		snapshot[key] = process.env[key];
		delete process.env[key];
	}
	return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
	for (const key of GEAP_ENV_KEYS) {
		const value = snapshot[key];
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
}

interface ServiceAccountCredentials {
	client_email: string;
	private_key: string;
	private_key_id?: string;
}

interface GoogleAuthOpts {
	credentials?: ServiceAccountCredentials;
	scopes?: string | string[];
}

/**
 * Programmable stub for `google-auth-library`'s `GoogleAuth`. Controls what
 * `getAccessToken()` returns by mutating `nextToken` / `nextError`.
 */
let nextToken: string | null | undefined = undefined;
let nextError: Error | undefined = undefined;
let constructorCalls: Array<GoogleAuthOpts> = [];

class GoogleAuthStub {
	constructor(public readonly opts: GoogleAuthOpts = {}) {
		constructorCalls.push(opts);
	}
	async getAccessToken(): Promise<string | null | undefined> {
		if (nextError) {
			throw nextError;
		}
		return nextToken;
	}
}

/**
 * Inject the stub into Node's module cache before the resolver imports it,
 * and evict any previously-cached resolver so it re-executes against the stub.
 */
function installGoogleAuthStub(): void {
	const resolvedPath = require.resolve('google-auth-library');
	require.cache[resolvedPath] = {
		id: resolvedPath,
		filename: resolvedPath,
		loaded: true,
		exports: { GoogleAuth: GoogleAuthStub },
	} as NodeJS.Module;

	// The extension may have already loaded the resolver with the real library.
	// Evict it so the require() below gets a fresh load against the stub.
	const resolverPath = require.resolve('../geapResolver');
	delete require.cache[resolverPath];
}

suite('resolveGeapCredential', () => {
	let envSnapshot: Record<string, string | undefined>;
	let resolveGeapCredential: typeof import('../geapResolver').resolveGeapCredential;

	suiteSetup(() => {
		installGoogleAuthStub();
		// Now require the resolver so it picks up the stubbed library.
		resolveGeapCredential = require('../geapResolver').resolveGeapCredential;
	});

	setup(() => {
		envSnapshot = snapshotEnv();
		nextToken = undefined;
		nextError = undefined;
		constructorCalls = [];
		// Project and location are required for the resolver to produce a
		// session payload. Provide them by default; the "missing
		// project/location" test deletes them explicitly.
		process.env.GOOGLE_VERTEX_PROJECT = TEST_PROJECT;
		process.env.GOOGLE_VERTEX_LOCATION = TEST_LOCATION;
	});

	teardown(() => {
		restoreEnv(envSnapshot);
	});

	test('returns JSON envelope from inline service-account env vars', async () => {
		process.env.GOOGLE_CLIENT_EMAIL = 'sa@example.iam.gserviceaccount.com';
		process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----';
		nextToken = 'ya29.inline-token';

		const payload = await resolveGeapCredential();

		assert.deepStrictEqual(JSON.parse(payload), {
			token: 'ya29.inline-token',
			project: TEST_PROJECT,
			location: TEST_LOCATION,
		});
		// The constructor was called with the inline credentials, not ADC defaults.
		assert.strictEqual(
			constructorCalls[0].credentials?.client_email,
			'sa@example.iam.gserviceaccount.com',
		);
	});

	test('falls back to ADC when inline env vars are absent', async () => {
		nextToken = 'ya29.adc-token';

		const payload = await resolveGeapCredential();

		assert.deepStrictEqual(JSON.parse(payload), {
			token: 'ya29.adc-token',
			project: TEST_PROJECT,
			location: TEST_LOCATION,
		});
		// ADC constructor is called with no `credentials` field.
		assert.strictEqual(constructorCalls[0].credentials, undefined);
	});

	test('throws when no credentials are available', async () => {
		// No client-email env vars; ADC returns null (no token).
		nextToken = null;

		await assert.rejects(
			resolveGeapCredential(),
			/No Gemini Enterprise Agent Platform credentials found/,
		);
	});

	test('surfaces inline credential errors instead of falling through to ADC', async () => {
		// When the user has set inline service-account env vars, a failure
		// to mint a token (e.g. malformed key) must be surfaced. Falling
		// through to ADC would produce a misleading "no credentials found"
		// error pointing at the vars the user already set.
		process.env.GOOGLE_CLIENT_EMAIL = 'sa@example.iam.gserviceaccount.com';
		process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nBAD\\n-----END PRIVATE KEY-----';
		nextError = new Error('invalid_grant: Invalid JWT Signature.');

		await assert.rejects(
			resolveGeapCredential(),
			/Inline service-account credentials failed: invalid_grant/,
		);
	});

	test('throws when project is missing even if credentials resolve', async () => {
		nextToken = 'ya29.adc-token';
		delete process.env.GOOGLE_VERTEX_PROJECT;

		await assert.rejects(
			resolveGeapCredential(),
			/requires a project and location/,
		);
	});

	test('settings take precedence over env vars for project and location', async () => {
		// The resolver reads project/location from settings first, then falls
		// back to env vars. If the order ever got reversed, env-var-only
		// users would silently override what they explicitly configured.
		process.env.GOOGLE_VERTEX_PROJECT = 'env-project';
		process.env.GOOGLE_VERTEX_LOCATION = 'env-location';
		nextToken = 'ya29.token';

		const vscode = require('vscode');
		const originalGetConfiguration = vscode.workspace.getConfiguration;
		vscode.workspace.getConfiguration = (section?: string) => {
			if (section === 'authentication.googleVertex') {
				return {
					get: (key: string) => key === 'credentials'
						? {
							GOOGLE_VERTEX_PROJECT: 'settings-project',
							GOOGLE_VERTEX_LOCATION: 'settings-location',
						}
						: undefined,
				};
			}
			return originalGetConfiguration.call(vscode.workspace, section);
		};

		try {
			const payload = JSON.parse(await resolveGeapCredential());
			assert.strictEqual(payload.project, 'settings-project');
			assert.strictEqual(payload.location, 'settings-location');
		} finally {
			vscode.workspace.getConfiguration = originalGetConfiguration;
		}
	});

	test('normalizes escaped newlines in inline private key', async () => {
		// Users often paste service-account keys from JSON into env vars,
		// which leaves the literal two-character `\n` sequence instead of
		// real newlines. The resolver must normalize before handing the
		// key to google-auth-library.
		process.env.GOOGLE_CLIENT_EMAIL = 'sa@example.iam.gserviceaccount.com';
		process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nABC\\nDEF\\n-----END PRIVATE KEY-----';
		nextToken = 'ya29.token';

		await resolveGeapCredential();

		assert.strictEqual(
			constructorCalls[0].credentials?.private_key,
			'-----BEGIN PRIVATE KEY-----\nABC\nDEF\n-----END PRIVATE KEY-----',
		);
	});
});
