/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AuthProvider, CredentialChainConfig } from '../authProvider';
import { AWS_AUTH_PROVIDER_ID } from '../constants';
import { createAwsCredentialChain, resolveAwsChainInit, watchWebIdentityTokenFile } from '../credentials/aws';

// clientConfig is only set for web-identity auth, so tests that assert it
// pass this env; SSO/other paths pass {} and must not get a clientConfig.
const WEB_IDENTITY_ENV = { AWS_WEB_IDENTITY_TOKEN_FILE: '/var/run/token' };

suite('resolveAwsChainInit', () => {
	test('passes the configured region to the STS client config', () => {
		const result = resolveAwsChainInit(
			{ region: 'eu-west-1' }, WEB_IDENTITY_ENV
		);

		assert.deepStrictEqual(result, { clientConfig: { region: 'eu-west-1' } });
	});

	test('prefers the setting region over the AWS_REGION env var', () => {
		const result = resolveAwsChainInit(
			{ region: 'eu-west-1' }, { ...WEB_IDENTITY_ENV, AWS_REGION: 'us-west-2' }
		);

		assert.deepStrictEqual(result, { clientConfig: { region: 'eu-west-1' } });
	});

	test('includes the profile when set, still passing the region', () => {
		const result = resolveAwsChainInit(
			{ profile: 'dev', region: 'ap-southeast-2' }, WEB_IDENTITY_ENV
		);

		assert.deepStrictEqual(result, {
			profile: 'dev',
			clientConfig: { region: 'ap-southeast-2' },
		});
	});

	test('omits clientConfig without web-identity so SSO keeps sso_region', () => {
		const result = resolveAwsChainInit(
			{ profile: 'sso-dev', region: 'eu-west-1' }, {}
		);

		assert.deepStrictEqual(result, { profile: 'sso-dev' });
	});
});

suite('AWS credential chain (web identity)', () => {
	let tokenDir: string;
	let tokenFile: string;
	let globalState: Map<string, unknown>;
	let chainCalls: number;
	let stsFails: boolean;
	let events: { added: number; changed: number; removed: number };
	// Runs once the next exchange has read the token file, success or not.
	let afterTokenRead: (() => Promise<void>) | undefined;
	let chain: CredentialChainConfig;
	let provider: AuthProvider;

	// Stands in for fromNodeProviderChain's web-identity leg: it reads the
	// token file, so it fails with ENOENT until the file exists, and the
	// STS exchange it would then make is replaced by fresh credentials.
	const fakeChain = () => async () => {
		chainCalls++;
		const hook = afterTokenRead;
		afterTokenRead = undefined;
		const idToken = await fs.promises.readFile(tokenFile, 'utf8')
			.finally(() => hook?.());
		if (stsFails) {
			throw new Error('STS unreachable');
		}
		return {
			accessKeyId: 'ASIA',
			secretAccessKey: `secret-${chainCalls}-${idToken}`,
			sessionToken: 'session',
			expiration: new Date(Date.now() + 60 * 60 * 1000),
		};
	};

	function createProvider(env: NodeJS.ProcessEnv): AuthProvider {
		const context = {
			secrets: { get: () => Promise.resolve(undefined) },
			globalState: {
				get: <T>(key: string) => globalState.get(key) as T | undefined,
				update: (key: string, value: unknown) => {
					globalState.set(key, value);
					return Promise.resolve();
				},
			},
		} as unknown as vscode.ExtensionContext;
		chain = createAwsCredentialChain(() => ({ region: 'eu-west-1' }), env, fakeChain);
		const created = new AuthProvider(AWS_AUTH_PROVIDER_ID, 'AWS', context, undefined, chain);
		created.onDidChangeSessions(e => {
			events.added += e.added?.length ?? 0;
			events.changed += e.changed?.length ?? 0;
			events.removed += e.removed?.length ?? 0;
		});
		return created;
	}

	/** Rewrite the token file with an mtime later than any earlier write. */
	function writeToken(secondsAhead: number): void {
		fs.writeFileSync(tokenFile, 'jwt');
		const mtime = new Date(Date.now() + secondsAhead * 1000);
		fs.utimesSync(tokenFile, mtime, mtime);
	}

	setup(() => {
		tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aws-web-identity-'));
		tokenFile = path.join(tokenDir, 'id_token');
		globalState = new Map();
		chainCalls = 0;
		stsFails = false;
		events = { added: 0, changed: 0, removed: 0 };
		afterTokenRead = undefined;
		provider = createProvider({
			AWS_WEB_IDENTITY_TOKEN_FILE: tokenFile,
			AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/bedrock',
		});
	});

	teardown(() => {
		provider.dispose();
		fs.rmSync(tokenDir, { recursive: true, force: true });
	});

	// #15292: on Workbench the token file is written asynchronously by the
	// session agent, so activation can resolve before it exists.
	test('signs in once the identity token file appears after a failed startup resolve', async () => {
		const atStartup = await provider.resolveChainCredentials();

		fs.writeFileSync(tokenFile, 'jwt');
		const sessions = await provider.getSessions();

		assert.deepStrictEqual(
			{ atStartup, sessions: sessions.length, events },
			{ atStartup: undefined, sessions: 1, events: { added: 1, changed: 0, removed: 0 } },
		);
	});

	test('does not retry while the token file is still missing', async () => {
		await provider.resolveChainCredentials();

		await provider.getSessions();
		await provider.getSessions();

		assert.strictEqual(chainCalls, 1);
	});

	test('held credentials are not re-resolved when the token file is rewritten', async () => {
		writeToken(0);
		await provider.resolveChainCredentials();

		writeToken(60);
		const sessions = await provider.getSessions();

		assert.deepStrictEqual(
			{ chainCalls, sessions: sessions.length, events },
			{ chainCalls: 1, sessions: 1, events: { added: 1, changed: 0, removed: 0 } },
		);
	});

	test('a failed exchange is retried once per token file rewrite', async () => {
		writeToken(0);
		stsFails = true;
		await provider.resolveChainCredentials();
		const unchangedFile = await provider.getSessions();

		stsFails = false;
		writeToken(60);
		const afterRewrite = await provider.getSessions();

		assert.deepStrictEqual(
			{ unchangedFile: unchangedFile.length, afterRewrite: afterRewrite.length, chainCalls },
			{ unchangedFile: 0, afterRewrite: 1, chainCalls: 2 },
		);
	});

	function watchTokenFile(): { dispose(): void } {
		const env = { AWS_WEB_IDENTITY_TOKEN_FILE: tokenFile };
		return watchWebIdentityTokenFile(env, chain, () => provider.resolveChainCredentials(), 20)!;
	}

	test('the token file watcher signs in without waiting for getSessions', async () => {
		fs.rmSync(tokenDir, { recursive: true, force: true });
		await provider.resolveChainCredentials();
		const watcher = watchTokenFile();
		try {
			const added = new Promise<void>(resolve => provider.onDidChangeSessions(e => {
				if (e.added?.length) {
					resolve();
				}
			}));

			// The folder is missing too, as it can be before the agent's first write.
			fs.mkdirSync(tokenDir);
			fs.writeFileSync(tokenFile, 'jwt');
			await added;
		} finally {
			watcher.dispose();
		}

		assert.deepStrictEqual(events, { added: 1, changed: 0, removed: 0 });
	});

	/**
	 * Race a startup resolve against the token file watcher: the startup
	 * resolve's token read fails before the agent writes the file, but its
	 * failure lands only after the watcher's resolve has signed in.
	 */
	async function signInWhileStartupFailsLate(): Promise<void> {
		let startupReadFailed!: () => void;
		const startupRead = new Promise<void>(resolve => startupReadFailed = resolve);
		let releaseStartup!: () => void;
		const startupReleased = new Promise<void>(resolve => releaseStartup = resolve);
		afterTokenRead = () => {
			startupReadFailed();
			return startupReleased;
		};
		const startup = provider.resolveChainCredentials();
		await startupRead;

		const watcher = watchTokenFile();
		try {
			const added = new Promise<void>(resolve => provider.onDidChangeSessions(e => {
				if (e.added?.length) {
					resolve();
				}
			}));
			writeToken(0);
			await added;
		} finally {
			watcher.dispose();
		}
		releaseStartup();
		await startup;
	}

	test('a startup resolve that fails late does not sign out the watcher resolve', async () => {
		await signInWhileStartupFailsLate();
		const sessions = await provider.getSessions();

		assert.deepStrictEqual(
			{ sessions: sessions.length, events },
			{ sessions: 1, events: { added: 1, changed: 0, removed: 0 } },
		);
	});

	test('a startup resolve that fails late does not re-enable token file refreshes', async () => {
		await signInWhileStartupFailsLate();
		const chainCallsAfterSignIn = chainCalls;

		writeToken(60);
		const sessions = await provider.getSessions();

		assert.deepStrictEqual(
			{ newChainCalls: chainCalls - chainCallsAfterSignIn, sessions: sessions.length, events },
			{ newChainCalls: 0, sessions: 1, events: { added: 1, changed: 0, removed: 0 } },
		);
	});

	test('without web identity, a failed resolve is not retried by getSessions', async () => {
		provider.dispose();
		provider = createProvider({});
		await provider.resolveChainCredentials();

		fs.writeFileSync(tokenFile, 'jwt');
		const sessions = await provider.getSessions();

		assert.deepStrictEqual(
			{ chainCalls, sessions: sessions.length },
			{ chainCalls: 1, sessions: 0 },
		);
	});
});
