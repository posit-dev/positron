/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { saveServerStateToTier, selectServerState } from '../KallichoreAdapterApi';
import { KallichoreServerState } from '../ServerState';

/**
 * Minimal in-memory stand-in for a {@link vscode.Memento}, enough to exercise
 * the storage-tier routing. Mirrors the Memento contract that `update(key,
 * undefined)` removes the key.
 */
class FakeMemento implements vscode.Memento {
	private readonly _store = new Map<string, unknown>();

	keys(): readonly string[] {
		return [...this._store.keys()];
	}

	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: string, defaultValue?: T): T | undefined {
		return this._store.has(key) ? (this._store.get(key) as T) : defaultValue;
	}

	async update(key: string, value: unknown): Promise<void> {
		if (value === undefined) {
			this._store.delete(key);
		} else {
			this._store.set(key, value);
		}
	}
}

function makeState(serverId: string): KallichoreServerState {
	return {
		base_path: 'http://127.0.0.1:8182/',
		port: 8182,
		server_path: '/usr/lib/bin/kcserver',
		server_pid: 4242,
		bearer_token: `token-${serverId}`,
		server_id: serverId,
		log_path: '/tmp/kallichore.log',
	};
}

const KEY = 'positron-supervisor.v2';

suite('saveServerStateToTier', () => {
	test('writes to the ephemeral tier and clears the persistent tier', async () => {
		const ephemeral = new FakeMemento();
		const persistent = new FakeMemento();
		// Seed the persistent tier so we can verify it is cleared.
		await persistent.update(KEY, makeState('stale'));

		const state = makeState('fresh');
		await saveServerStateToTier(true, ephemeral, persistent, state);

		assert.deepStrictEqual(ephemeral.get(KEY), state);
		assert.strictEqual(persistent.get(KEY), undefined);
	});

	test('writes to the persistent tier and clears the ephemeral tier', async () => {
		const ephemeral = new FakeMemento();
		const persistent = new FakeMemento();
		// Seed the ephemeral tier so we can verify it is cleared.
		await ephemeral.update(KEY, makeState('stale'));

		const state = makeState('fresh');
		await saveServerStateToTier(false, ephemeral, persistent, state);

		assert.deepStrictEqual(persistent.get(KEY), state);
		assert.strictEqual(ephemeral.get(KEY), undefined);
	});

	test('clears both tiers when saving undefined', async () => {
		const ephemeral = new FakeMemento();
		const persistent = new FakeMemento();
		await ephemeral.update(KEY, makeState('a'));
		await persistent.update(KEY, makeState('b'));

		await saveServerStateToTier(true, ephemeral, persistent, undefined);

		assert.strictEqual(ephemeral.get(KEY), undefined);
		assert.strictEqual(persistent.get(KEY), undefined);
	});
});

suite('selectServerState', () => {
	test('round-trips state through the ephemeral tier', async () => {
		const ephemeral = new FakeMemento();
		const persistent = new FakeMemento();
		const state = makeState('fresh');

		await saveServerStateToTier(true, ephemeral, persistent, state);
		const loaded = selectServerState(
			true,
			ephemeral.get<KallichoreServerState>(KEY),
			persistent.get<KallichoreServerState>(KEY));

		assert.deepStrictEqual(loaded, state);
	});

	test('falls back to the other tier after a shutdown timeout change', () => {
		// The setting was 'indefinitely' (persistent) last session and is now
		// 'immediately' (ephemeral). The state lives in the persistent tier; the
		// load must fall back to it rather than return nothing.
		const state = makeState('persisted');
		const loaded = selectServerState(true, /* ephemeral */ undefined, state);
		assert.deepStrictEqual(loaded, state);
	});

	test('falls back to the ephemeral tier when persistent is empty', () => {
		const state = makeState('ephemeral');
		const loaded = selectServerState(false, state, /* persistent */ undefined);
		assert.deepStrictEqual(loaded, state);
	});

	test('prefers the appropriate tier when both hold state', () => {
		const ephemeral = makeState('ephemeral');
		const persistent = makeState('persistent');
		assert.deepStrictEqual(selectServerState(true, ephemeral, persistent), ephemeral);
		assert.deepStrictEqual(selectServerState(false, ephemeral, persistent), persistent);
	});

	test('returns undefined when neither tier holds state', () => {
		assert.strictEqual(selectServerState(true, undefined, undefined), undefined);
	});
});
