/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { PackageEditorInput } from '../../browser/packageEditorInput.js';

describe('PackageEditorInput', () => {
	ensureNoLeakedDisposables();

	let store: DisposableStore;

	beforeEach(() => {
		store = new DisposableStore();
	});

	afterEach(() => {
		store.dispose();
	});

	function input(sessionId: string, name: string): PackageEditorInput {
		return store.add(new PackageEditorInput({ languageId: 'r', sessionId, packageName: name }));
	}

	it('matches another input with the same session and package name', () => {
		expect(input('s1', 'dplyr').matches(input('s1', 'dplyr'))).toBe(true);
	});

	it('matches case-insensitively on package name', () => {
		expect(input('s1', 'dplyr').matches(input('s1', 'DPLYR'))).toBe(true);
	});

	it('does not match a different session', () => {
		expect(input('s1', 'dplyr').matches(input('s2', 'dplyr'))).toBe(false);
	});

	it('does not match a different package', () => {
		expect(input('s1', 'dplyr').matches(input('s1', 'tidyr'))).toBe(false);
	});

	it('exposes a stable resource and a descriptive name', () => {
		const i = input('s1', 'dplyr');
		expect(i.resource?.scheme).toBe('positron-package');
		expect(i.resource?.authority).toBe('s1');
		expect(i.resource?.path).toBe('/dplyr');
		expect(i.getName()).toContain('dplyr');
	});

	it('produces a case-insensitive resource so framework deduplication is consistent with matches()', () => {
		expect(input('s1', 'DPLYR').resource?.path).toBe('/dplyr');
	});
});
