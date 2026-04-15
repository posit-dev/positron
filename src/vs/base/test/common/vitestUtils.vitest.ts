/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />


import { Disposable } from '../../common/lifecycle.js';
import { ensureNoLeakedDisposables } from './vitestUtils.js';

describe('ensureNoLeakedDisposables', () => {
	const disposables = ensureNoLeakedDisposables();

	it('passes when disposables are properly cleaned up', () => {
		const d = disposables.add(new Disposable());
		expect(d).toBeDefined();
	});

	it('tracks add() calls', () => {
		class TestDisposable extends Disposable { }
		const d = disposables.add(new TestDisposable());
		expect(d).toBeInstanceOf(TestDisposable);
	});
});
