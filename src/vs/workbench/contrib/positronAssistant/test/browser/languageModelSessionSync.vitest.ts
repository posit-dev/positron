/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoLeakedDisposables } from '../../../../../base/test/common/vitestSetup.js';
import { AuthenticationSession, AuthenticationSessionsChangeEvent, IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import { syncAuthSessions } from '../../browser/languageModelSessionSync.js';

describe('syncAuthSessions', () => {
	const disposables = ensureNoLeakedDisposables();

	let emitter: Emitter<{ providerId: string; label: string; event: AuthenticationSessionsChangeEvent }>;
	let sessionsMap: Map<string, AuthenticationSession[]>;
	let authService: IAuthenticationService;

	beforeEach(() => {
		emitter = disposables.add(
			new Emitter<{ providerId: string; label: string; event: AuthenticationSessionsChangeEvent }>()
		);
		sessionsMap = new Map();
		authService = {
			onDidChangeSessions: emitter.event,
			getSessions: async (providerId: string) => {
				return sessionsMap.get(providerId) ?? [];
			},
		} as unknown as IAuthenticationService;
	});

	it('updates signedIn to true when session added for matching provider', async () => {
		const results: { providerId: string; signedIn: boolean }[] = [];
		disposables.add(
			syncAuthSessions(authService, ['anthropic-api'], (providerId, signedIn) => {
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
		disposables.add(
			syncAuthSessions(authService, ['anthropic-api'], (providerId, signedIn) => {
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
		disposables.add(
			syncAuthSessions(authService, ['anthropic-api'], (providerId, signedIn) => {
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

	it('disposes listener on cleanup', () => {
		const results: { providerId: string; signedIn: boolean }[] = [];
		const disposable = syncAuthSessions(
			authService,
			['anthropic-api'],
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
