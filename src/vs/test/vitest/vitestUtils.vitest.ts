/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../base/common/lifecycle.js';
import { ensureNoLeakedDisposables } from './vitestUtils.js';

// `Disposable` is abstract, so tests use a trivial concrete subclass.
class TestDisposable extends Disposable { }

describe('ensureNoLeakedDisposables', () => {
	const disposables = ensureNoLeakedDisposables();

	it('passes when disposables are properly cleaned up', () => {
		const d = disposables.add(new TestDisposable());
		expect(d).toBeDefined();
	});

	it('tracks add() calls', () => {
		const d = disposables.add(new TestDisposable());
		expect(d).toBeInstanceOf(TestDisposable);
	});
});
