/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

/**
 * Snapshot/restore for env vars touched by the Vertex resolver.
 */
const VERTEX_ENV_KEYS = [
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
	for (const key of VERTEX_ENV_KEYS) {
		snapshot[key] = process.env[key];
		delete process.env[key];
	}
	return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
	for (const key of VERTEX_ENV_KEYS) {
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
 * Programmable stub for `google-auth-library`'s `GoogleAuth`. The resolver
 * captures one `GoogleAuth` instance per env-var signature; we control what
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
	const resolverPath = require.resolve('../googleVertexResolver');
	delete require.cache[resolverPath];
}

suite('resolveGoogleVertexCredential', () => {
	let envSnapshot: Record<string, string | undefined>;
	let resolveGoogleVertexCredential: typeof import('../googleVertexResolver').resolveGoogleVertexCredential;
	let _resetGoogleVertexResolverForTests: typeof import('../googleVertexResolver')._resetGoogleVertexResolverForTests;

	suiteSetup(() => {
		installGoogleAuthStub();
		// Now require the resolver so it picks up the stubbed library.
		const mod = require('../googleVertexResolver');
		resolveGoogleVertexCredential = mod.resolveGoogleVertexCredential;
		_resetGoogleVertexResolverForTests = mod._resetGoogleVertexResolverForTests;
	});

	setup(() => {
		envSnapshot = snapshotEnv();
		_resetGoogleVertexResolverForTests();
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
		_resetGoogleVertexResolverForTests();
	});

	test('returns JSON envelope from inline service-account env vars', async () => {
		process.env.GOOGLE_CLIENT_EMAIL = 'sa@example.iam.gserviceaccount.com';
		process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----';
		nextToken = 'ya29.inline-token';

		const payload = await resolveGoogleVertexCredential();

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

		const payload = await resolveGoogleVertexCredential();

		assert.deepStrictEqual(JSON.parse(payload), {
			token: 'ya29.adc-token',
			project: TEST_PROJECT,
			location: TEST_LOCATION,
		});
		// ADC constructor is called with no `credentials` field.
		assert.strictEqual(constructorCalls[0].credentials, undefined);
	});

	test('inline credentials win over ADC when both could resolve', async () => {
		process.env.GOOGLE_CLIENT_EMAIL = 'sa@example.iam.gserviceaccount.com';
		process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----';
		nextToken = 'ya29.first-token';

		await resolveGoogleVertexCredential();

		// Only the inline constructor should have run -- ADC was never tried.
		assert.strictEqual(constructorCalls.length, 1);
		assert.ok(constructorCalls[0].credentials?.client_email);
	});

	test('throws when no credentials are available', async () => {
		// No client-email env vars; ADC returns null (no token).
		nextToken = null;

		await assert.rejects(
			resolveGoogleVertexCredential(),
			/No Google Vertex AI credentials found/,
		);
	});

	test('throws when project is missing even if credentials resolve', async () => {
		nextToken = 'ya29.adc-token';
		delete process.env.GOOGLE_VERTEX_PROJECT;

		await assert.rejects(
			resolveGoogleVertexCredential(),
			/requires a project and location/,
		);
	});

	test('throws when location is missing even if credentials resolve', async () => {
		nextToken = 'ya29.adc-token';
		delete process.env.GOOGLE_VERTEX_LOCATION;

		await assert.rejects(
			resolveGoogleVertexCredential(),
			/requires a project and location/,
		);
	});

	test('falls through to ADC when inline credentials fail to mint', async () => {
		process.env.GOOGLE_CLIENT_EMAIL = 'sa@example.iam.gserviceaccount.com';
		process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----';

		// First call (inline) returns null; second call (ADC) returns a token.
		let callCount = 0;
		const originalGetAccessToken = GoogleAuthStub.prototype.getAccessToken;
		GoogleAuthStub.prototype.getAccessToken = async function () {
			callCount++;
			if (callCount === 1) {
				return null; // inline path fails
			}
			return 'ya29.adc-fallback-token';
		};

		try {
			const payload = await resolveGoogleVertexCredential();
			assert.deepStrictEqual(JSON.parse(payload), {
				token: 'ya29.adc-fallback-token',
				project: TEST_PROJECT,
				location: TEST_LOCATION,
			});
			// Both constructors should have been called: inline (with credentials) then ADC (without).
			assert.strictEqual(constructorCalls.length, 2);
			assert.ok((constructorCalls[0] as GoogleAuthOpts).credentials?.client_email, 'inline constructor first');
			assert.strictEqual((constructorCalls[1] as GoogleAuthOpts).credentials, undefined, 'ADC constructor second');
		} finally {
			GoogleAuthStub.prototype.getAccessToken = originalGetAccessToken;
		}
	});
});

suite('validateGoogleVertexCredentials', () => {
	let envSnapshot: Record<string, string | undefined>;
	let validateGoogleVertexCredentials: typeof import('../validation/googleVertex').validateGoogleVertexCredentials;
	let _resetGoogleVertexResolverForTests: typeof import('../googleVertexResolver')._resetGoogleVertexResolverForTests;

	suiteSetup(() => {
		// Re-install the stub and evict both the resolver and the validator so
		// they pick up the stub on their next require() call.
		installGoogleAuthStub();

		const validatorPath = require.resolve('../validation/googleVertex');
		delete require.cache[validatorPath];

		validateGoogleVertexCredentials =
			require('../validation/googleVertex').validateGoogleVertexCredentials;
		_resetGoogleVertexResolverForTests =
			require('../googleVertexResolver')._resetGoogleVertexResolverForTests;
	});

	setup(() => {
		envSnapshot = snapshotEnv();
		_resetGoogleVertexResolverForTests();
		nextToken = undefined;
		nextError = undefined;
		constructorCalls = [];
		process.env.GOOGLE_VERTEX_PROJECT = TEST_PROJECT;
		process.env.GOOGLE_VERTEX_LOCATION = TEST_LOCATION;
	});

	teardown(() => {
		restoreEnv(envSnapshot);
		_resetGoogleVertexResolverForTests();
	});

	test('resolves when the resolver returns a payload', async () => {
		nextToken = 'ya29.probe-token';

		await validateGoogleVertexCredentials('', {
			type: 1, // PositronLanguageModelType.Chat
			provider: 'google-vertex',
			name: 'Vertex',
			model: 'gemini-2.5-flash',
		} as any);
	});

	test('rejects with friendly error when no credentials are available', async () => {
		// ADC returns null; resolver throws "No Google Vertex AI credentials found".
		nextToken = null;

		await assert.rejects(
			() => validateGoogleVertexCredentials('', {
				type: 1,
				provider: 'google-vertex',
				name: 'Vertex',
				model: 'gemini-2.5-flash',
			} as any),
			/Vertex AI:/,
		);
	});

	test('rejects with friendly error when project is missing', async () => {
		nextToken = 'ya29.probe-token';
		delete process.env.GOOGLE_VERTEX_PROJECT;

		await assert.rejects(
			() => validateGoogleVertexCredentials('', {
				type: 1,
				provider: 'google-vertex',
				name: 'Vertex',
				model: 'gemini-2.5-flash',
			} as any),
			/requires a project and location/,
		);
	});
});
