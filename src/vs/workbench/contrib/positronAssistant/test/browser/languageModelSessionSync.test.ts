/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AuthenticationSession, AuthenticationSessionsChangeEvent, IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import { syncAuthSessions } from '../../browser/languageModelSessionSync.js';

suite('syncAuthSessions', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let emitter: Emitter<{ providerId: string; label: string; event: AuthenticationSessionsChangeEvent }>;
	let sessionsMap: Map<string, AuthenticationSession[]>;
	let authService: IAuthenticationService;

	setup(() => {
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

	test('updates signedIn to true when session added for matching provider', async () => {
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

		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].providerId, 'anthropic-api');
		assert.strictEqual(results[0].signedIn, true);
	});

	test('updates signedIn to false when all sessions removed', async () => {
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

		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].providerId, 'anthropic-api');
		assert.strictEqual(results[0].signedIn, false);
	});

	test('ignores session changes for non-matching providers', async () => {
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

		assert.strictEqual(results.length, 0);
	});

	test('disposes listener on cleanup', () => {
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

		assert.strictEqual(results.length, 0);
	});
});
