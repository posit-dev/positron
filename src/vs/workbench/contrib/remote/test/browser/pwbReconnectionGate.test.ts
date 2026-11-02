/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { PwbReconnectionGate } from '../../browser/pwbReconnectionGate.js';

suite('PWB reconnection gate', () => {
	const ds = ensureNoDisposablesAreLeakedInTestSuite();

	test('starts logged in, so an unknown state keeps the normal schedule', () => {
		assert.strictEqual(ds.add(new PwbReconnectionGate()).isLoggedIn, true);
	});

	test('fires onDidLogin once per logged-out to logged-in change', () => {
		const gate = ds.add(new PwbReconnectionGate());
		let logins = 0;
		ds.add(gate.onDidLogin(() => logins++));
		gate.setLoggedIn(true);
		assert.strictEqual(logins, 0, 'already logged in');
		gate.setLoggedIn(false);
		gate.setLoggedIn(false);
		assert.strictEqual(gate.isLoggedIn, false);
		gate.setLoggedIn(true);
		gate.setLoggedIn(true);
		assert.strictEqual(logins, 1);
		assert.strictEqual(gate.isLoggedIn, true);
	});

	test('ignores reports without a boolean', () => {
		const gate = ds.add(new PwbReconnectionGate());
		gate.setLoggedIn(false);
		gate.setLoggedIn(undefined);
		assert.strictEqual(gate.isLoggedIn, false);
	});
});
