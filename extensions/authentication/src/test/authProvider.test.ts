/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { AuthProvider } from '../authProvider';
import { log } from '../log';

function createMockContext(): vscode.ExtensionContext {
	const secrets = new Map<string, string>();
	const globalState = new Map<string, unknown>();
	return {
		secrets: {
			get: (key: string) => Promise.resolve(secrets.get(key)),
			store: (key: string, value: string) => {
				secrets.set(key, value);
				return Promise.resolve();
			},
			delete: (key: string) => {
				secrets.delete(key);
				return Promise.resolve();
			},
		},
		globalState: {
			get: <T>(key: string) => globalState.get(key) as T | undefined,
			update: (key: string, value: unknown) => {
				globalState.set(key, value);
				return Promise.resolve();
			},
		},
	} as unknown as vscode.ExtensionContext;
}

suite('AuthProvider', () => {
	let provider: AuthProvider;
	let secrets: Map<string, string>;
	let globalState: Map<string, unknown>;

	setup(() => {
		secrets = new Map();
		globalState = new Map();

		const mockContext = {
			secrets: {
				get: (key: string) => Promise.resolve(secrets.get(key)),
				store: (key: string, value: string) => {
					secrets.set(key, value);
					return Promise.resolve();
				},
				delete: (key: string) => {
					secrets.delete(key);
					return Promise.resolve();
				},
			},
			globalState: {
				get: <T>(key: string) => globalState.get(key) as T | undefined,
				update: (key: string, value: unknown) => {
					globalState.set(key, value);
					return Promise.resolve();
				},
			},
		} as unknown as vscode.ExtensionContext;

		provider = new AuthProvider(
			'test-provider',
			'Test Provider',
			mockContext,
		);
	});

	teardown(() => {
		provider.dispose();
	});

	test('storeKey fires onDidChangeSessions with added session', async () => {
		const eventPromise = new Promise<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>(
			resolve => {
				const disposable = provider.onDidChangeSessions(e => {
					disposable.dispose();
					resolve(e);
				});
			}
		);

		await provider.storeKey('acc-1', 'Test Account', 'sk-test-key');
		const event = await eventPromise;

		assert.strictEqual(event.added!.length, 1);
		assert.strictEqual(event.added![0].id, 'acc-1');
		assert.strictEqual(event.added![0].accessToken, 'sk-test-key');
		assert.strictEqual(event.removed!.length, 0);
	});

	test('removeSession fires onDidChangeSessions with removed session', async () => {
		// First store a session
		await provider.storeKey('acc-1', 'Test Account', 'sk-test-key');

		const eventPromise = new Promise<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>(
			resolve => {
				const disposable = provider.onDidChangeSessions(e => {
					disposable.dispose();
					resolve(e);
				});
			}
		);

		await provider.removeSession('acc-1');
		const event = await eventPromise;

		assert.strictEqual(event.removed!.length, 1);
		assert.strictEqual(event.removed![0].id, 'acc-1');
		assert.strictEqual(event.added!.length, 0);
	});

	test('removeSession for nonexistent id does not fire event', async () => {
		let eventFired = false;
		const disposable = provider.onDidChangeSessions(() => {
			eventFired = true;
		});

		await provider.removeSession('nonexistent-id');

		// Give any async events a chance to fire
		await new Promise(resolve => setTimeout(resolve, 50));

		assert.strictEqual(eventFired, false);
		disposable.dispose();
	});

	test('getSessions returns stored sessions', async () => {
		await provider.storeKey('acc-1', 'Account 1', 'key-1');
		await provider.storeKey('acc-2', 'Account 2', 'key-2');

		const sessions = await provider.getSessions();

		assert.strictEqual(sessions.length, 2);
		const ids = sessions.map(s => s.id).sort();
		assert.deepStrictEqual(ids, ['acc-1', 'acc-2']);
		assert.strictEqual(
			sessions.find(s => s.id === 'acc-1')!.accessToken,
			'key-1'
		);
	});
});

suite('AuthProvider (credential chain)', () => {
	let chainProvider: AuthProvider;
	let resolveResult: string;
	let resolveShouldFail: boolean;

	setup(() => {
		resolveResult = JSON.stringify({ accessKeyId: 'AKIA', secretAccessKey: 'secret' });
		resolveShouldFail = false;

		chainProvider = new AuthProvider(
			'test-chain', 'Test Chain', createMockContext(),
			undefined,
			{
				resolve: async () => {
					if (resolveShouldFail) {
						throw new Error('chain failed');
					}
					return resolveResult;
				},
			}
		);
	});

	teardown(() => {
		chainProvider.dispose();
	});

	test('resolveChainCredentials returns session and fires added event', async () => {
		const eventPromise = new Promise<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>(
			resolve => {
				const disposable = chainProvider.onDidChangeSessions(e => {
					disposable.dispose();
					resolve(e);
				});
			}
		);

		const session = await chainProvider.resolveChainCredentials();
		const event = await eventPromise;

		assert.ok(session);
		assert.strictEqual(session.id, 'test-chain');
		assert.strictEqual(session.accessToken, resolveResult);
		assert.strictEqual(session.account.id, 'test-chain');
		assert.strictEqual(event.added!.length, 1);
	});

	test('removeSession clears chain session by default', async () => {
		await chainProvider.resolveChainCredentials();

		const eventPromise = new Promise<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>(
			resolve => {
				const disposable = chainProvider.onDidChangeSessions(e => {
					disposable.dispose();
					resolve(e);
				});
			}
		);

		await chainProvider.removeSession('test-chain');
		const event = await eventPromise;

		assert.strictEqual(event.removed!.length, 1);
		const sessions = await chainProvider.getSessions();
		assert.strictEqual(sessions.length, 0);
	});

	test('removeSession is blocked when preventSignOut is set and chain resolves', async () => {
		const protectedProvider = new AuthProvider(
			'test-protected', 'Test Protected', createMockContext(),
			undefined,
			{
				resolve: async () => resolveResult,
				preventSignOut: true,
			}
		);
		await protectedProvider.resolveChainCredentials();

		await protectedProvider.removeSession('test-protected');

		// Session should still exist because preventSignOut is set
		const sessions = await protectedProvider.getSessions();
		assert.strictEqual(sessions.length, 1);
		assert.strictEqual(sessions[0].id, 'test-protected');
		protectedProvider.dispose();
	});

	test('removeSession clears chain session when chain fails', async () => {
		await chainProvider.resolveChainCredentials();

		// Make the chain fail so removal is allowed
		resolveShouldFail = true;

		const eventPromise = new Promise<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>(
			resolve => {
				const disposable = chainProvider.onDidChangeSessions(e => {
					disposable.dispose();
					resolve(e);
				});
			}
		);

		await chainProvider.removeSession('test-chain');
		const event = await eventPromise;

		assert.strictEqual(event.removed!.length, 1);
		assert.strictEqual(event.removed![0].id, 'test-chain');

		const sessions = await chainProvider.getSessions();
		assert.strictEqual(sessions.length, 0);
	});

	test('createSession resolves from chain instead of prompting', async () => {
		const session = await chainProvider.createSession([], {});

		assert.strictEqual(session.id, 'test-chain');
		assert.strictEqual(session.accessToken, resolveResult);
	});

	test('resolveChainCredentials invalidates cached session on failure', async () => {
		await chainProvider.resolveChainCredentials();
		let sessions = await chainProvider.getSessions();
		assert.strictEqual(sessions.length, 1);

		resolveShouldFail = true;

		const eventPromise = new Promise<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>(
			resolve => {
				const disposable = chainProvider.onDidChangeSessions(e => {
					disposable.dispose();
					resolve(e);
				});
			}
		);

		await chainProvider.resolveChainCredentials();
		const event = await eventPromise;

		assert.strictEqual(event.removed!.length, 1);
		sessions = await chainProvider.getSessions();
		assert.strictEqual(sessions.length, 0);
	});
});

suite('AuthProvider - credential chain refresh', () => {
	const providers: AuthProvider[] = [];

	function track(provider: AuthProvider): AuthProvider {
		providers.push(provider);
		return provider;
	}

	teardown(() => {
		sinon.restore();
		while (providers.length) {
			providers.pop()!.dispose();
		}
	});

	test('credentials with no expiry stay signed in without re-resolving (string form)', async () => {
		let count = 0;
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{ resolve: async () => { count++; return 'x'; } }
		));

		await provider.resolveChainCredentials();
		await provider.getSessions();
		await provider.getSessions();
		const sessions = await provider.getSessions();

		assert.strictEqual(count, 1);
		assert.strictEqual(sessions[0].accessToken, 'x');
	});

	test('credentials with no expiry stay signed in without re-resolving (object form)', async () => {
		let count = 0;
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{ resolve: async () => { count++; return { token: 'x' }; } }
		));

		await provider.resolveChainCredentials();
		await provider.getSessions();
		await provider.getSessions();
		await provider.getSessions();

		assert.strictEqual(count, 1);
	});

	test('credentials still well before expiry are reused, not re-fetched', async () => {
		let count = 0;
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{
				resolve: async () => {
					count++;
					return { token: 'x', expiration: new Date(Date.now() + 2 * 60 * 1000) };
				},
			}
		));

		await provider.resolveChainCredentials();
		await provider.getSessions();
		await provider.getSessions();

		assert.strictEqual(count, 1);
	});

	test('credentials nearing expiry are refreshed before being handed out', async () => {
		let count = 0;
		const tokens = ['x', 'y'];
		const expirations = [
			new Date(Date.now() + 30 * 1000),
			new Date(Date.now() + 60 * 60 * 1000),
		];
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{
				resolve: async () => {
					const i = count++;
					return { token: tokens[i], expiration: expirations[i] };
				},
			}
		));

		await provider.resolveChainCredentials();
		const sessions = await provider.getSessions();
		const after = await provider.getSessions();

		assert.strictEqual(count, 2);
		assert.strictEqual(sessions[0].accessToken, 'y');
		// The refreshed 1h expiration re-armed the buffer, so the next
		// getSessions() does not resolve again.
		assert.strictEqual(after[0].accessToken, 'y');
	});

	test('user is signed out when expiring credentials can no longer be refreshed', async () => {
		let count = 0;
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{
				resolve: async () => {
					if (count++ === 0) {
						return { token: 'x', expiration: new Date(Date.now() + 30 * 1000) };
					}
					throw new Error('chain failed');
				},
			}
		));

		await provider.resolveChainCredentials();

		const removedEvents: vscode.AuthenticationSession[] = [];
		const disposable = provider.onDidChangeSessions(e => {
			removedEvents.push(...(e.removed ?? []));
		});

		const sessions = await provider.getSessions();
		disposable.dispose();

		assert.strictEqual(sessions.length, 0);
		assert.strictEqual(removedEvents.length, 1);
		// The invalidated session is the cached chain session, not some other.
		assert.strictEqual(removedEvents[0].accessToken, 'x');
	});

	test('refreshed credentials notify consumers that the session changed', async () => {
		let count = 0;
		const tokens = ['x', 'y'];
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{ resolve: async () => tokens[count++] }
		));

		const events = { added: 0, removed: 0, changed: 0 };
		const changedSessions: vscode.AuthenticationSession[] = [];
		const disposable = provider.onDidChangeSessions(e => {
			events.added += e.added?.length ?? 0;
			events.removed += e.removed?.length ?? 0;
			events.changed += e.changed?.length ?? 0;
			changedSessions.push(...(e.changed ?? []));
		});

		await provider.resolveChainCredentials();
		await provider.resolveChainCredentials();
		disposable.dispose();

		assert.deepStrictEqual(events, { added: 1, removed: 0, changed: 1 });
		// The changed event carries the new token, not the stale one.
		assert.strictEqual(changedSessions[0].accessToken, 'y');
	});

	test('signing in resolves credentials and makes the session available', async () => {
		let count = 0;
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{ resolve: async () => { count++; return 'x'; } }
		));

		const session = await provider.resolveChainCredentials();

		assert.strictEqual(count, 1);
		assert.ok(session);
		assert.strictEqual(session.accessToken, 'x');
	});

	test('a provider that refreshes on demand still works (Snowflake-style)', async () => {
		let count = 0;
		let refreshOnNext = false;
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{
				resolve: async () => { count++; return 'x'; },
				shouldRefresh: async () => {
					const should = refreshOnNext;
					refreshOnNext = false;
					return should;
				},
			}
		));

		await provider.resolveChainCredentials();
		await provider.getSessions();
		refreshOnNext = true;
		await provider.getSessions();

		assert.strictEqual(count, 2);
	});

	test('a provider that refreshes on a timer still works (Vertex-style)', async () => {
		const clock = sinon.useFakeTimers();
		let count = 0;
		// Not tracked for teardown disposal: dispose() clears the interval and
		// must run while the fake clock owns that timer, before clock.restore().
		const provider = new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{ resolve: async () => { count++; return 'x'; }, refreshIntervalMs: 1000 }
		);

		try {
			await provider.resolveChainCredentials();
			assert.strictEqual(count, 1);

			await clock.tickAsync(1000);

			assert.strictEqual(count, 2);
		} finally {
			provider.dispose();
			clock.restore();
		}
	});

	test('getSessions waits for an in-flight resolution instead of returning no sessions', async () => {
		let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{ resolve: async () => { await gate; return 'x'; } }
		));

		// Fire-and-forget, like the eager resolve during activation.
		const resolution = provider.resolveChainCredentials();
		const sessionsPromise = provider.getSessions();
		release();
		await resolution;

		const sessions = await sessionsPromise;
		assert.strictEqual(sessions.length, 1);
		assert.strictEqual(sessions[0].accessToken, 'x');
	});
});

suite('AuthProvider - configured provider state', () => {
	const providers: AuthProvider[] = [];

	function track(provider: AuthProvider): AuthProvider {
		providers.push(provider);
		return provider;
	}

	teardown(() => {
		sinon.restore();
		while (providers.length) {
			providers.pop()!.dispose();
		}
	});

	test('chain provider is not configured before first resolution', async () => {
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{ resolve: async () => 'x' }
		));

		assert.strictEqual(await provider.isConfigured(), false);
	});

	test('successful chain resolution marks the provider configured', async () => {
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{ resolve: async () => 'x' }
		));

		await provider.resolveChainCredentials();

		assert.strictEqual(await provider.isConfigured(), true);
	});

	test('failed resolution keeps a previously configured provider configured', async () => {
		let count = 0;
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{
				resolve: async () => {
					if (count++ === 0) { return 'x'; }
					throw new Error('chain failed');
				},
			}
		));

		await provider.resolveChainCredentials();
		await provider.resolveChainCredentials();

		assert.strictEqual((await provider.getSessions()).length, 0);
		assert.strictEqual(await provider.isConfigured(), true);
	});

	test('chain sign-out clears the configured flag', async () => {
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{ resolve: async () => 'x' }
		));

		await provider.resolveChainCredentials();
		await provider.removeSession('test');

		assert.strictEqual(await provider.isConfigured(), false);
	});

	test('sign-out clears the configured flag even when the cached session is gone', async () => {
		let count = 0;
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{
				resolve: async () => {
					if (count++ === 0) { return 'x'; }
					throw new Error('chain failed');
				},
			}
		));

		await provider.resolveChainCredentials();
		await provider.resolveChainCredentials(); // fails, invalidates session
		await provider.removeSession('test');

		assert.strictEqual(await provider.isConfigured(), false);
	});

	test('preventSignOut chains are not marked configured', async () => {
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{ resolve: async () => 'x', preventSignOut: true }
		));

		await provider.resolveChainCredentials();

		assert.strictEqual(await provider.isConfigured(), false);
	});

	test('stored API keys mark the provider configured until removed', async () => {
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext()
		));

		await provider.storeKey('acc-1', 'Account', 'sk-key');
		assert.strictEqual(await provider.isConfigured(), true);

		await provider.removeSession('acc-1');
		assert.strictEqual(await provider.isConfigured(), false);
	});

	test('explicit API-key sign-out clears the persisted configured flag', async () => {
		// For a provider carrying the persisted "configured" flag plus a
		// stored API key, removing the key must also forget the flag, so a
		// later empty session list reads as signed-out, not expired.
		const context = createMockContext();
		await context.globalState.update('authentication.previouslySignedIn.test', true);
		const provider = track(new AuthProvider('test', 'Test', context));
		await provider.storeKey('acc-1', 'Account', 'sk-key');
		assert.strictEqual(await provider.isConfigured(), true);

		await provider.removeSession('acc-1');

		assert.strictEqual(await provider.isConfigured(), false);
	});

	test('failed resolution for a configured provider logs at warn', async () => {
		const warnSpy = sinon.spy(log, 'warn');
		let count = 0;
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{
				resolve: async () => {
					if (count++ === 0) { return 'x'; }
					throw new Error('chain failed');
				},
			}
		));

		await provider.resolveChainCredentials();
		await provider.resolveChainCredentials();

		const warnings = warnSpy.getCalls().map(call => String(call.args[0]));
		assert.ok(
			warnings.some(msg => msg.includes('[Test]') && msg.includes('chain failed')),
			`expected warn naming provider and error, got: ${warnings.join(' | ')}`
		);
	});

	test('failed resolution for an unconfigured provider does not warn', async () => {
		const warnSpy = sinon.spy(log, 'warn');
		const provider = track(new AuthProvider(
			'test', 'Test', createMockContext(), undefined,
			{ resolve: async () => { throw new Error('no creds'); } }
		));

		await provider.resolveChainCredentials();

		const providerWarnings = warnSpy.getCalls()
			.filter(call => String(call.args[0]).includes('[Test]'));
		assert.strictEqual(providerWarnings.length, 0);
	});
});
