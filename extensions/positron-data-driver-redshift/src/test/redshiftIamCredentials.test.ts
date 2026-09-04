/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Covers IAM authorization without reaching AWS. The credential module's only network-touching
// pieces are its two senders, so injecting those leaves the request building, the response mapping,
// and the provider's caching and refresh logic fully exercised here.
//
// The two APIs are tested separately on purpose: they differ in the case of every field
// (`dbUser` versus `DbUser`) and in whether a database user is supplied or derived, which is exactly
// the kind of difference that would otherwise only show up against live infrastructure.

import * as assert from 'assert';
import * as vscode from 'vscode';
import { PgClientFactory, RedshiftClient, RedshiftFieldConfig } from '../redshiftClient.js';
import { RedshiftConnection } from '../redshiftConnection.js';
import { createRedshiftDriver } from '../redshiftDriver.js';
import {
	ClusterCredentialsSender,
	createIamCredentialProvider,
	getClusterCredentials,
	getServerlessCredentials,
	RedshiftIamConfig,
	RedshiftIamCredentials,
	ServerlessCredentialsSender,
} from '../redshiftIamCredentials.js';

/** A serverless target, matching the shape the driver derives from an endpoint. */
const SERVERLESS: RedshiftIamConfig = {
	kind: 'serverless',
	name: 'my-workgroup',
	region: 'us-east-2',
	database: 'dev',
	profile: 'PowerUser-123456789012',
};

/** A provisioned target. Unlike serverless, this one names the database user to assume. */
const PROVISIONED: RedshiftIamConfig = {
	kind: 'provisioned',
	name: 'my-cluster',
	region: 'us-east-1',
	database: 'dev',
	profile: 'PowerUser-123456789012',
	dbUser: 'analyst',
};

/** An expiry far enough out that the provider treats the credentials as usable. */
function farFuture(): Date {
	return new Date(Date.now() + 3_600_000);
}

suite('Redshift IAM Credentials - Serverless', () => {

	test('builds the GetCredentials request from the target', async () => {
		const seen: unknown[] = [];
		const send: ServerlessCredentialsSender = async (_config, input) => {
			seen.push(input);
			return { dbUser: 'IAMR:x', dbPassword: 'p', expiration: farFuture(), $metadata: {} };
		};

		await getServerlessCredentials(SERVERLESS, send);

		// The maximum lifetime is requested rather than accepting the 900s default, so a browsing
		// session re-mints as rarely as AWS allows.
		assert.deepStrictEqual(seen, [{
			workgroupName: 'my-workgroup',
			dbName: 'dev',
			durationSeconds: 3600,
		}]);
	});

	test('maps the camelCase response', async () => {
		const expiration = farFuture();
		const send: ServerlessCredentialsSender = async () => ({
			dbUser: 'IAMR:AWSReservedSSO_PowerUser_abc',
			dbPassword: 'temporary-password',
			expiration,
			$metadata: {},
		});

		const credentials = await getServerlessCredentials(SERVERLESS, send);

		assert.deepStrictEqual(credentials, {
			user: 'IAMR:AWSReservedSSO_PowerUser_abc',
			password: 'temporary-password',
			expiresAt: expiration,
		});
	});

	test('falls back to the requested lifetime when AWS reports no expiry', async () => {
		const send: ServerlessCredentialsSender = async () => ({ dbUser: 'u', dbPassword: 'p', $metadata: {} });

		const before = Date.now();
		const credentials = await getServerlessCredentials(SERVERLESS, send);

		// Roughly an hour out, without asserting an exact instant.
		const seconds = (credentials.expiresAt.getTime() - before) / 1000;
		assert.ok(seconds > 3500 && seconds <= 3600, `expected ~3600s, got ${seconds}`);
	});

	test('throws when the response carries no password', async () => {
		const send: ServerlessCredentialsSender = async () => ({ dbUser: 'u', $metadata: {} });

		await assert.rejects(() => getServerlessCredentials(SERVERLESS, send), /no credentials/i);
	});
});

suite('Redshift IAM Credentials - Provisioned', () => {

	test('builds the GetClusterCredentials request, with auto-create off', async () => {
		const seen: unknown[] = [];
		const send: ClusterCredentialsSender = async (_config, input) => {
			seen.push(input);
			return { DbUser: 'IAM:analyst', DbPassword: 'p', Expiration: farFuture(), $metadata: {} };
		};

		await getClusterCredentials(PROVISIONED, send);

		// AutoCreate stays false so connecting never silently creates a database user.
		assert.deepStrictEqual(seen, [{
			ClusterIdentifier: 'my-cluster',
			DbName: 'dev',
			DbUser: 'analyst',
			DurationSeconds: 3600,
			AutoCreate: false,
		}]);
	});

	test('maps the PascalCase response, preferring the returned prefixed user', async () => {
		const Expiration = farFuture();
		const send: ClusterCredentialsSender = async () => ({
			// AWS returns the user prefixed, which is not what was asked for.
			DbUser: 'IAM:analyst',
			DbPassword: 'temporary-password',
			Expiration,
			$metadata: {},
		});

		const credentials = await getClusterCredentials(PROVISIONED, send);

		assert.deepStrictEqual(credentials, {
			user: 'IAM:analyst',
			password: 'temporary-password',
			expiresAt: Expiration,
		});
	});

	test('rejects a target with no database user before calling AWS', async () => {
		let called = false;
		const send: ClusterCredentialsSender = async () => {
			called = true;
			return { $metadata: {} };
		};
		const { dbUser, ...withoutUser } = PROVISIONED;

		await assert.rejects(() => getClusterCredentials(withoutUser, send), /database user is required/i);
		assert.strictEqual(called, false, 'should not reach AWS without a database user');
	});

	test('throws when the response carries no password', async () => {
		const send: ClusterCredentialsSender = async () => ({ DbUser: 'IAM:analyst', $metadata: {} });

		await assert.rejects(() => getClusterCredentials(PROVISIONED, send), /no credentials/i);
	});
});

suite('Redshift IAM Credential Provider', () => {

	// Records how often credentials were minted and with what refresh flag, and hands back
	// credentials whose expiry the test controls.
	function fakeFetcher(expiresAt: () => Date = farFuture) {
		let calls = 0;
		return {
			get calls() { return calls; },
			fetch: async (): Promise<RedshiftIamCredentials> => {
				calls++;
				return { user: `user-${calls}`, password: `password-${calls}`, expiresAt: expiresAt() };
			},
		};
	}

	test('reuses credentials that are still valid', async () => {
		const fetcher = fakeFetcher();
		const provider = createIamCredentialProvider(SERVERLESS, undefined, fetcher.fetch);

		const first = await provider();
		const second = await provider();

		assert.strictEqual(fetcher.calls, 1);
		assert.deepStrictEqual(second, first);
	});

	test('re-mints when asked to force a refresh', async () => {
		const fetcher = fakeFetcher();
		const provider = createIamCredentialProvider(SERVERLESS, undefined, fetcher.fetch);

		await provider();
		const refreshed = await provider(true);

		assert.strictEqual(fetcher.calls, 2);
		assert.strictEqual(refreshed.user, 'user-2');
	});

	test('re-mints credentials that are about to expire', async () => {
		// Inside the margin that covers the connect round trip, so these count as already stale.
		const fetcher = fakeFetcher(() => new Date(Date.now() + 30_000));
		const provider = createIamCredentialProvider(SERVERLESS, undefined, fetcher.fetch);

		await provider();
		await provider();

		assert.strictEqual(fetcher.calls, 2);
	});

	test('credentials just outside the margin are still reused', async () => {
		// Pins the boundary from the other side, so a margin change cannot silently start
		// re-minting on every call.
		const fetcher = fakeFetcher(() => new Date(Date.now() + 120_000));
		const provider = createIamCredentialProvider(SERVERLESS, undefined, fetcher.fetch);

		await provider();
		await provider();

		assert.strictEqual(fetcher.calls, 1);
	});

	test('coalesces concurrent callers onto one AWS call', async () => {
		const fetcher = fakeFetcher();
		const provider = createIamCredentialProvider(SERVERLESS, undefined, fetcher.fetch);

		const results = await Promise.all([provider(), provider(), provider()]);

		assert.strictEqual(fetcher.calls, 1);
		assert.deepStrictEqual(results[1], results[0]);
		assert.deepStrictEqual(results[2], results[0]);
	});

	test('a credential-resolution failure points at the profile and signing in again', async () => {
		const err = Object.assign(new Error('Could not load credentials from any providers'), {
			name: 'CredentialsProviderError',
		});
		const provider = createIamCredentialProvider(SERVERLESS, undefined, async () => { throw err; });

		// The remedy is an SSO sign-in for a named profile, which has nothing to do with Redshift.
		await assert.rejects(provider, (thrown: Error) => {
			assert.match(thrown.message, /PowerUser-123456789012/);
			assert.match(thrown.message, /aws sso login/);
			return true;
		});
	});

	test('an expired session is reported as expired, not as missing credentials', async () => {
		// The shape the SDK produces once the SSO cache has aged out.
		const err = Object.assign(
			new Error('Error when retrieving token from sso: Token has expired and refresh failed'),
			{ name: 'CredentialsProviderError' });
		const provider = createIamCredentialProvider(SERVERLESS, undefined, async () => { throw err; });

		await assert.rejects(provider, (thrown: Error) => {
			assert.match(thrown.message, /has expired/i);
			assert.match(thrown.message, /aws sso login --profile PowerUser-123456789012/);
			// Signing in is the fix, so do not send the reader off to inspect their config.
			assert.doesNotMatch(thrown.message, /No AWS credentials found/i);
			return true;
		});
	});

	test('no credentials with no profile set names the profile field, not an expired session', async () => {
		// The case that is easy to misdiagnose: the session is fine, but nothing named a profile,
		// and with IAM Identity Center the default chain has no long-lived keys to fall back on.
		const err = Object.assign(new Error('Could not load credentials from any providers'), {
			name: 'CredentialsProviderError',
		});
		const { profile, ...withoutProfile } = SERVERLESS;
		const provider = createIamCredentialProvider(withoutProfile, undefined, async () => { throw err; });

		await assert.rejects(provider, (thrown: Error) => {
			assert.match(thrown.message, /No AWS credentials found/i);
			assert.match(thrown.message, /AWS Profile/);
			assert.match(thrown.message, /\[default\] profile/);
			// The session was never the problem, so claiming expiry would be wrong.
			assert.doesNotMatch(thrown.message, /expired/i);
			return true;
		});
	});

	test('no credentials for a named profile does not claim the session expired', async () => {
		const err = Object.assign(new Error('Profile PowerUser-123456789012 could not be found'), {
			name: 'CredentialsProviderError',
		});
		const provider = createIamCredentialProvider(SERVERLESS, undefined, async () => { throw err; });

		await assert.rejects(provider, (thrown: Error) => {
			assert.match(thrown.message, /No AWS credentials found for profile 'PowerUser-123456789012'/);
			assert.doesNotMatch(thrown.message, /has expired/i);
			return true;
		});
	});

	test('a workgroup failure names the workgroup and region instead of blaming sign-in', async () => {
		const provider = createIamCredentialProvider(SERVERLESS, undefined, async () => {
			throw new Error('Serverless workgroup my-workgroup not found.');
		});

		await assert.rejects(provider, (thrown: Error) => {
			assert.match(thrown.message, /my-workgroup/);
			assert.match(thrown.message, /us-east-2/);
			assert.doesNotMatch(thrown.message, /aws sso login/);
			return true;
		});
	});

	test('a provisioned failure is described as a cluster', async () => {
		const provider = createIamCredentialProvider(PROVISIONED, undefined, async () => {
			throw new Error('ClusterNotFound');
		});

		await assert.rejects(provider, (thrown: Error) => {
			assert.match(thrown.message, /cluster 'my-cluster'/);
			return true;
		});
	});

	test('a failure is not cached, so the next attempt tries again', async () => {
		let calls = 0;
		const provider = createIamCredentialProvider(SERVERLESS, undefined, async () => {
			calls++;
			if (calls === 1) {
				throw new Error('transient');
			}
			return { user: 'u', password: 'p', expiresAt: farFuture() };
		});

		await assert.rejects(provider);
		const credentials = await provider();

		assert.strictEqual(calls, 2);
		assert.strictEqual(credentials.user, 'u');
	});
});

suite('Redshift IAM Credential Refresh in the Client', () => {

	const IAM_FIELDS: RedshiftFieldConfig = {
		host: 'my-workgroup.123456789012.us-east-2.redshift-serverless.amazonaws.com',
		port: 5439,
		database: 'dev',
		// Empty under IAM: AWS derives the user and returns it.
		user: '',
		ssl: true,
	};

	// A fake pg Client whose per-instance handler may throw to simulate a failure.
	class FakeClient {
		constructor(private readonly _handler: (sql: string) => { rows: unknown[] }) { }
		async connect() { }
		async query(sql: string) { return this._handler(sql); }
		async end() { }
		on() { return this; }
	}

	// Builds a factory that records the config each client was built from, so a test can see which
	// credentials were actually handed to pg.
	function recordingFactory(handlers: Array<(sql: string) => { rows: unknown[] }>) {
		const configs: RedshiftFieldConfig[] = [];
		const factory: PgClientFactory = config => {
			const client = new FakeClient(handlers[configs.length] ?? (() => ({ rows: [] })));
			configs.push(config);
			// eslint-disable-next-line local/code-no-any-casts
			return client as any;
		};
		return { factory, configs };
	}

	// A provider that mints a new pair each time and records the refresh flag it was passed.
	function recordingProvider() {
		const forced: Array<boolean | undefined> = [];
		let issued = 0;
		return {
			get forced() { return forced; },
			provider: async (forceRefresh?: boolean): Promise<RedshiftIamCredentials> => {
				forced.push(forceRefresh);
				issued++;
				return { user: `IAMR:user-${issued}`, password: `secret-${issued}`, expiresAt: farFuture() };
			},
		};
	}

	test('mints credentials and hands them to pg in place of the configured ones', async () => {
		const { factory, configs } = recordingFactory([]);
		const { provider } = recordingProvider();
		const client = new RedshiftClient({ ...IAM_FIELDS, credentialProvider: provider }, factory);

		await client.connect();

		assert.strictEqual(configs.length, 1);
		assert.strictEqual(configs[0].user, 'IAMR:user-1');
		assert.strictEqual(configs[0].password, 'secret-1');
		assert.strictEqual(client.resolvedUser, 'IAMR:user-1');
	});

	test('re-mints on reconnect, so credentials cannot outlive the connection', async () => {
		const { factory, configs } = recordingFactory([
			() => { throw new Error('Connection terminated unexpectedly'); },
			() => ({ rows: [{ ok: true }] }),
		]);
		const { provider } = recordingProvider();
		const client = new RedshiftClient({ ...IAM_FIELDS, credentialProvider: provider }, factory);

		await client.connect();
		await client.query('SELECT 1');

		// The second pg client was built from freshly minted credentials, not the first pair.
		assert.strictEqual(configs.length, 2);
		assert.strictEqual(configs[1].password, 'secret-2');
	});

	test('rejected credentials trigger a forced re-mint and one retry', async () => {
		const { factory, configs } = recordingFactory([
			// Expiry does not look like a dead socket; it comes back as an auth failure.
			() => { throw Object.assign(new Error('password authentication failed'), { code: '28P01' }); },
			() => ({ rows: [{ ok: true }] }),
		]);
		const recorder = recordingProvider();
		const client = new RedshiftClient({ ...IAM_FIELDS, credentialProvider: recorder.provider }, factory);

		await client.connect();
		const result = await client.query('SELECT 1');

		assert.deepStrictEqual(result.rows, [{ ok: true }]);
		// The refresh is forced: the cached pair was just rejected, so reusing it would fail again.
		assert.deepStrictEqual(recorder.forced, [false, true]);
		assert.strictEqual(configs[1].password, 'secret-2');
	});

	test('the other invalid-authorization code also forces a re-mint', async () => {
		const { factory } = recordingFactory([
			() => { throw Object.assign(new Error('invalid authorization specification'), { code: '28000' }); },
			() => ({ rows: [{ ok: true }] }),
		]);
		const recorder = recordingProvider();
		const client = new RedshiftClient({ ...IAM_FIELDS, credentialProvider: recorder.provider }, factory);

		await client.connect();
		await client.query('SELECT 1');

		assert.deepStrictEqual(recorder.forced, [false, true]);
	});

	test('resolvedUser falls back to the configured user when nothing is minted', async () => {
		const { factory } = recordingFactory([]);
		const client = new RedshiftClient({ ...IAM_FIELDS, user: 'someone' }, factory);

		await client.connect();

		assert.strictEqual(client.resolvedUser, 'someone');
	});

	test('a connection survives a reconnect whose credential mint failed', async () => {
		const { factory, configs } = recordingFactory([
			() => { throw new Error('Connection terminated unexpectedly'); },
			() => ({ rows: [{ ok: true }] }),
		]);
		let attempts = 0;
		const client = new RedshiftClient({
			...IAM_FIELDS,
			credentialProvider: async () => {
				attempts++;
				// The mint fails once -- an expired SSO session, say -- then starts working again.
				if (attempts === 2) {
					throw new Error('Token has expired and refresh failed');
				}
				return { user: 'IAMR:u', password: `secret-${attempts}`, expiresAt: farFuture() };
			},
		}, factory);

		await client.connect();
		// The reconnect this triggers cannot mint, so it leaves no pg client behind.
		await assert.rejects(() => client.query('SELECT 1'));

		// Once the user fixes their session the connection must come back. Without a retry here the
		// failure is permanent, because "client is closed" is neither a socket nor an auth error.
		const result = await client.query('SELECT 1');
		assert.deepStrictEqual(result.rows, [{ ok: true }]);
		assert.strictEqual(configs[1].password, 'secret-3');
	});

	test('a deliberate close is not resurrected by a later query', async () => {
		const { factory } = recordingFactory([]);
		const client = new RedshiftClient({ ...IAM_FIELDS, user: 'someone' }, factory);

		await client.connect();
		await client.end();

		await assert.rejects(() => client.query('SELECT 1'), /closed/i);
	});

	test('an auth failure without a credential provider is not retried', async () => {
		const { factory, configs } = recordingFactory([
			() => { throw Object.assign(new Error('password authentication failed'), { code: '28P01' }); },
		]);
		const client = new RedshiftClient({ ...IAM_FIELDS, user: 'someone', password: 'static' }, factory);

		await client.connect();

		// Nothing to re-mint, so a wrong password is a real error rather than a refresh opportunity.
		await assert.rejects(() => client.query('SELECT 1'), /password authentication failed/);
		assert.strictEqual(configs.length, 1);
	});
});

suite('Redshift IAM Connection Wiring', () => {

	// A no-op Data Explorer host; these tests exercise connecting, not previewing.
	const noopHost = {
		previewObject: async () => 'noop-dataset',
		previewColumn: async () => 'noop-dataset',
		openTableView: async () => { },
		openColumnView: async () => { },
		closeTableView: () => { },
	};

	/** The extension context, needed only so the driver can read its icon off disk. */
	function testContext(): vscode.ExtensionContext {
		const extension = vscode.extensions.getExtension('positron.positron-data-driver-redshift');
		assert.ok(extension, 'the Redshift driver extension should be present');
		// eslint-disable-next-line local/code-no-any-casts
		return { extensionPath: extension.extensionPath } as any;
	}

	// A pg client that answers the cross-database probe, recording the config it was built from.
	function recordingFactory() {
		const configs: RedshiftFieldConfig[] = [];
		const factory: PgClientFactory = config => {
			configs.push(config);
			// eslint-disable-next-line local/code-no-any-casts
			return {
				connect: async () => { },
				query: async () => ({ rows: [{ ok: 1 }] }),
				end: async () => { },
				on() { return this; },
			} as any;
		};
		return { factory, configs };
	}

	test('an IAM connection mints credentials and connects as the returned user', async () => {
		const { factory, configs } = recordingFactory();
		// The whole chain runs for real here: config -> credential provider -> pg client. Only the
		// AWS call and the socket are faked.
		const connection = new RedshiftConnection({
			kind: 'iam',
			host: 'my-workgroup.123456789012.us-east-2.redshift-serverless.amazonaws.com',
			port: 5439,
			database: 'dev',
			user: '',
			ssl: true,
			iam: SERVERLESS,
		}, noopHost, undefined, {
			pgClientFactory: factory,
			credentialFetcher: async () => ({
				user: 'IAMR:AWSReservedSSO_PowerUser_abc',
				password: 'minted',
				expiresAt: farFuture(),
			}),
		});

		await connection.connect();

		// The credentials AWS returned, not the empty ones the config carried.
		assert.strictEqual(configs[0].user, 'IAMR:AWSReservedSSO_PowerUser_abc');
		assert.strictEqual(configs[0].password, 'minted');
		await connection.disconnect();
	});

	test('a fields connection never reaches the credential path', async () => {
		const { factory, configs } = recordingFactory();
		let minted = false;
		const connection = new RedshiftConnection({
			kind: 'fields',
			host: 'my-cluster.abc.us-east-1.redshift.amazonaws.com',
			port: 5439,
			database: 'dev',
			user: 'admin',
			password: 'static',
			ssl: true,
		}, noopHost, undefined, {
			pgClientFactory: factory,
			credentialFetcher: async () => { minted = true; throw new Error('should not be called'); },
		});

		await connection.connect();

		assert.strictEqual(minted, false, 'password auth must not mint IAM credentials');
		assert.strictEqual(configs[0].user, 'admin');
		await connection.disconnect();
	});

	test('a credential failure surfaces as a connect failure with the remedy intact', async () => {
		const { factory } = recordingFactory();
		const connection = new RedshiftConnection({
			kind: 'iam',
			host: 'my-workgroup.123456789012.us-east-2.redshift-serverless.amazonaws.com',
			port: 5439,
			database: 'dev',
			user: '',
			ssl: true,
			iam: SERVERLESS,
		}, noopHost, undefined, {
			pgClientFactory: factory,
			credentialFetcher: async () => {
				throw Object.assign(new Error('Token has expired and refresh failed'), {
					name: 'CredentialsProviderError',
				});
			},
		});

		// The advice must survive being wrapped by the connection's own error message.
		await assert.rejects(() => connection.connect(), /has expired.*aws sso login --profile/s);
	});

	test('a provisioned login rejection explains that the database user may not exist', async () => {
		const factory: PgClientFactory = () => {
			// AutoCreate is off, so AWS issued credentials for a user the cluster never had; the
			// login is what fails.
			// eslint-disable-next-line local/code-no-any-casts
			return {
				connect: async () => {
					throw Object.assign(new Error('password authentication failed for user "IAM:analyst"'),
						{ code: '28P01' });
				},
				query: async () => ({ rows: [] }),
				end: async () => { },
				on() { return this; },
			} as any;
		};
		const connection = new RedshiftConnection({
			kind: 'iam',
			host: 'my-cluster.abc.us-east-1.redshift.amazonaws.com',
			port: 5439,
			database: 'dev',
			user: '',
			ssl: true,
			iam: PROVISIONED,
		}, noopHost, undefined, {
			pgClientFactory: factory,
			credentialFetcher: async () => ({ user: 'IAM:analyst', password: 'minted', expiresAt: farFuture() }),
		});

		await assert.rejects(() => connection.connect(), (err: Error) => {
			// The raw driver error is kept, with the actual cause appended.
			assert.match(err.message, /password authentication failed/);
			assert.match(err.message, /database user 'analyst' may not exist in cluster 'my-cluster'/);
			return true;
		});
	});

	test('a serverless login rejection gets no cluster-user hint', async () => {
		const factory: PgClientFactory = () => {
			// eslint-disable-next-line local/code-no-any-casts
			return {
				connect: async () => {
					throw Object.assign(new Error('password authentication failed'), { code: '28P01' });
				},
				query: async () => ({ rows: [] }),
				end: async () => { },
				on() { return this; },
			} as any;
		};
		const connection = new RedshiftConnection({
			kind: 'iam',
			host: 'my-workgroup.123456789012.us-east-2.redshift-serverless.amazonaws.com',
			port: 5439,
			database: 'dev',
			user: '',
			ssl: true,
			iam: SERVERLESS,
		}, noopHost, undefined, {
			pgClientFactory: factory,
			credentialFetcher: async () => ({ user: 'IAMR:x', password: 'minted', expiresAt: farFuture() }),
		});

		// Serverless derives the user, so there is no user to create and no advice to give.
		await assert.rejects(() => connection.connect(), (err: Error) => {
			assert.doesNotMatch(err.message, /may not exist/);
			return true;
		});
	});

	test('the driver offers an AWS IAM mechanism that asks for no password', () => {
		const driver = createRedshiftDriver(testContext(), noopHost as never);
		const iam = driver.mechanisms.find(m => m.id === 'iam');

		assert.ok(iam, 'the driver should offer an IAM mechanism');
		const ids = iam.parameters.map(p => p.id);
		assert.deepStrictEqual(ids, ['host', 'port', 'database', 'profile', 'dbUser', 'ssl']);
		// Nothing secret is collected: AWS supplies both halves of the credential.
		assert.strictEqual(iam.parameters.some(p => p.id === 'password'), false);
	});

	test('the driver generates IAM code for both languages', async () => {
		const driver = createRedshiftDriver(testContext(), noopHost as never);
		const params = {
			host: 'my-workgroup.123456789012.us-east-2.redshift-serverless.amazonaws.com',
			port: 5439,
			database: 'dev',
			profile: 'work',
		};

		const python = await driver.generateConnectionCode!('iam', 'python', params);
		const r = await driver.generateConnectionCode!('iam', 'r', params);

		assert.match(python[0].code, /iam=True/);
		assert.match(r[0].code, /paws::redshiftserverless/);
	});

	test('the driver offers no IAM code until the endpoint resolves', async () => {
		const driver = createRedshiftDriver(testContext(), noopHost as never);

		// A half-typed host is not an error to show the user, just nothing to generate yet.
		const code = await driver.generateConnectionCode!('iam', 'python', {
			host: 'my-workgroup', port: 5439, database: 'dev',
		});

		assert.deepStrictEqual(code, []);
	});
});
