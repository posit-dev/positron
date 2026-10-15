/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { declaresAuthProvider, ProviderRegistration, registerUnlessAssistantOwns } from '../extension';

/** Records what a test registration did, with a `ready` promise the test settles. */
class FakeProvider {
	registered = 0;
	disposed = 0;
	failNext = false;
	private resolveReady: () => void = () => { };

	register = (): ProviderRegistration => {
		if (this.failNext) {
			this.failNext = false;
			throw new Error('already registered');
		}
		this.registered++;
		return {
			disposable: new vscode.Disposable(() => this.disposed++),
			ready: new Promise(resolve => { this.resolveReady = resolve; }),
		};
	};

	finishReady() {
		this.resolveReady();
	}

	get active() {
		return this.registered - this.disposed;
	}
}

suite('registerUnlessAssistantOwns', () => {
	let assistantOwns: boolean;
	let extensionsChanged: vscode.EventEmitter<void>;
	let fake: FakeProvider;

	setup(() => {
		assistantOwns = false;
		extensionsChanged = new vscode.EventEmitter<void>();
		fake = new FakeProvider();
	});

	teardown(() => {
		extensionsChanged.dispose();
	});

	function start(): ProviderRegistration {
		return registerUnlessAssistantOwns('databricks', fake.register, () => assistantOwns, extensionsChanged.event);
	}

	function changeExtensions(owns: boolean) {
		assistantOwns = owns;
		extensionsChanged.fire();
	}

	test('registers when Assistant does not, and skips it when Assistant does', () => {
		start();
		assistantOwns = true;
		const other = new FakeProvider();
		registerUnlessAssistantOwns('databricks', other.register, () => assistantOwns, extensionsChanged.event);

		assert.deepStrictEqual({ mine: fake.active, whenOwned: other.registered }, { mine: 1, whenOwned: 0 });
	});

	test('steps aside while credentials are still resolving, and comes back when Assistant goes', async () => {
		const registration = start();
		changeExtensions(true);
		const afterAssistantArrives = fake.active;
		fake.finishReady();
		await registration.ready;
		changeExtensions(false);

		assert.deepStrictEqual(
			{ afterAssistantArrives, afterAssistantLeaves: fake.active, registered: fake.registered },
			{ afterAssistantArrives: 0, afterAssistantLeaves: 1, registered: 2 }
		);
	});

	test('retries on the next extension change when registering throws', async () => {
		fake.failNext = true;
		await assert.rejects(start().ready, /already registered/);
		const afterFailure = fake.active;
		changeExtensions(false);

		assert.deepStrictEqual({ afterFailure, afterRetry: fake.active }, { afterFailure: 0, afterRetry: 1 });
	});

	test('disposing unregisters and stops reacting to extension changes', () => {
		start().disposable.dispose();
		const afterDispose = fake.active;
		changeExtensions(false);

		assert.deepStrictEqual({ afterDispose, afterChange: fake.active }, { afterDispose: 0, afterChange: 0 });
	});
});

suite('declaresAuthProvider', () => {
	test('matches only ids in contributes.authentication', () => {
		const manifest = {
			activationEvents: ['onAuthenticationRequest:snowflake-cortex'],
			contributes: { authentication: [{ id: 'databricks', label: 'Databricks' }] },
		};

		assert.deepStrictEqual(
			{
				declared: declaresAuthProvider(manifest, 'databricks'),
				activationEventOnly: declaresAuthProvider(manifest, 'snowflake-cortex'),
				noExtension: declaresAuthProvider(undefined, 'databricks'),
			},
			{ declared: true, activationEventOnly: false, noExtension: false }
		);
	});
});
