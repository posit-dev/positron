/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { AuthenticationSession, AuthenticationSessionsChangeEvent, IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import { syncAuthSessions } from '../../browser/languageModelSessionSync.js';

describe('syncAuthSessions', () => {
	const ctx = createTestContainer().build();

	let emitter: Emitter<{ providerId: string; label: string; event: AuthenticationSessionsChangeEvent }>;
	let sessionsMap: Map<string, AuthenticationSession[]>;
	let reads: string[];
	let authService: IAuthenticationService;

	/** Key a custom entry's sessions the way a scoped read asks for them. */
	const scopedKey = (providerId: string, scopes?: readonly string[]) =>
		scopes?.length ? `${providerId}::${scopes.join('|')}` : providerId;

	const session = (id: string): AuthenticationSession =>
		({ id, accessToken: 'key', account: { id, label: id }, scopes: [] });

	beforeEach(() => {
		emitter = ctx.disposables.add(
			new Emitter<{ providerId: string; label: string; event: AuthenticationSessionsChangeEvent }>()
		);
		sessionsMap = new Map();
		reads = [];
		authService = stubInterface<IAuthenticationService>({
			onDidChangeSessions: emitter.event,
			getSessions: async (providerId: string, scopes?: readonly string[]) => {
				reads.push(scopedKey(providerId, scopes));
				return sessionsMap.get(scopedKey(providerId, scopes)) ?? [];
			},
		});
	});

	it('updates signedIn to true when session added for matching provider', async () => {
		const results: { providerId: string; signedIn: boolean }[] = [];
		ctx.disposables.add(
			syncAuthSessions(authService, [{ id: 'anthropic-api' }], (providerId, signedIn) => {
				results.push({ providerId, signedIn });
			})
		);

		sessionsMap.set('anthropic-api', [
			{ id: '1', accessToken: 'key', account: { id: '1', label: 'test' }, scopes: [] },
		]);
		emitter.fire({
			providerId: 'anthropic-api',
			label: 'Anthropic',
			event: { added: [{ id: '1', accessToken: 'key', account: { id: '1', label: 'test' }, scopes: [] }], removed: undefined, changed: undefined },
		});

		// Allow the async handler to complete
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(results.length).toBe(1);
		expect(results[0].providerId).toBe('anthropic-api');
		expect(results[0].signedIn).toBe(true);
	});

	it('updates signedIn to false when all sessions removed', async () => {
		const results: { providerId: string; signedIn: boolean }[] = [];
		ctx.disposables.add(
			syncAuthSessions(authService, [{ id: 'anthropic-api' }], (providerId, signedIn) => {
				results.push({ providerId, signedIn });
			})
		);

		// No sessions for this provider
		sessionsMap.set('anthropic-api', []);
		emitter.fire({
			providerId: 'anthropic-api',
			label: 'Anthropic',
			event: { added: undefined, removed: [{ id: '1', accessToken: '', account: { id: '1', label: 'test' }, scopes: [] }], changed: undefined },
		});

		await new Promise(resolve => setTimeout(resolve, 0));

		expect(results.length).toBe(1);
		expect(results[0].providerId).toBe('anthropic-api');
		expect(results[0].signedIn).toBe(false);
	});

	it('ignores session changes for non-matching providers', async () => {
		const results: { providerId: string; signedIn: boolean }[] = [];
		ctx.disposables.add(
			syncAuthSessions(authService, [{ id: 'anthropic-api' }], (providerId, signedIn) => {
				results.push({ providerId, signedIn });
			})
		);

		emitter.fire({
			providerId: 'github',
			label: 'GitHub',
			event: { added: [{ id: '1', accessToken: 'tok', account: { id: '1', label: 'user' }, scopes: [] }], removed: undefined, changed: undefined },
		});

		await new Promise(resolve => setTimeout(resolve, 0));

		expect(results.length).toBe(0);
	});

	it('asks each custom entry for its own scope, so one signing in does not mark them all', async () => {
		// The union read is what this guards against: an unscoped read on the
		// shared provider returns every entry's sessions at once, which would
		// report both entries as signed in as soon as either one was.
		const results: { providerId: string; signedIn: boolean }[] = [];
		ctx.disposables.add(
			syncAuthSessions(
				authService,
				[{ id: 'my anthropic', custom: true }, { id: 'my openai', custom: true }],
				(providerId, signedIn) => {
					results.push({ providerId, signedIn });
				}
			)
		);

		sessionsMap.set('positron-custom-provider::my anthropic', [session('1')]);
		emitter.fire({
			providerId: 'positron-custom-provider',
			label: 'Custom Providers',
			event: { added: [session('1')], removed: undefined, changed: undefined },
		});

		await new Promise(resolve => setTimeout(resolve, 0));

		expect({ results, reads }).toEqual({
			results: [
				{ providerId: 'my anthropic', signedIn: true },
				{ providerId: 'my openai', signedIn: false },
			],
			// By scope, never by the event's account label: the label is the
			// entry name today, but a display string deciding identity flips
			// the wrong row the moment the two diverge.
			reads: [
				'positron-custom-provider::my anthropic',
				'positron-custom-provider::my openai',
			],
		});
	});

	it('leaves built-in providers out of a custom-provider change, and the reverse', async () => {
		const results: { providerId: string; signedIn: boolean }[] = [];
		ctx.disposables.add(
			syncAuthSessions(
				authService,
				[{ id: 'anthropic-api' }, { id: 'my anthropic', custom: true }],
				(providerId, signedIn) => {
					results.push({ providerId, signedIn });
				}
			)
		);

		emitter.fire({
			providerId: 'positron-custom-provider',
			label: 'Custom Providers',
			event: { added: [session('1')], removed: undefined, changed: undefined },
		});
		emitter.fire({
			providerId: 'anthropic-api',
			label: 'Anthropic',
			event: { added: [session('2')], removed: undefined, changed: undefined },
		});

		await new Promise(resolve => setTimeout(resolve, 0));

		expect(results).toEqual([
			{ providerId: 'my anthropic', signedIn: false },
			{ providerId: 'anthropic-api', signedIn: false },
		]);
	});

	it('disposes listener on cleanup', () => {
		const results: { providerId: string; signedIn: boolean }[] = [];
		const disposable = syncAuthSessions(
			authService,
			[{ id: 'anthropic-api' }],
			(providerId, signedIn) => {
				results.push({ providerId, signedIn });
			}
		);
		disposable.dispose();

		sessionsMap.set('anthropic-api', [
			{ id: '1', accessToken: 'key', account: { id: '1', label: 'test' }, scopes: [] },
		]);
		emitter.fire({
			providerId: 'anthropic-api',
			label: 'Anthropic',
			event: { added: [{ id: '1', accessToken: 'key', account: { id: '1', label: 'test' }, scopes: [] }], removed: undefined, changed: undefined },
		});

		expect(results.length).toBe(0);
	});
});
