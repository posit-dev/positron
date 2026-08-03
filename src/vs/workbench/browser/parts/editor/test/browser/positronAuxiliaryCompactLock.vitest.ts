/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { shouldAllowCompactChange } from '../../positronAuxiliaryCompactLock.js';

describe('shouldAllowCompactChange', () => {

	it('refuses compact changes for windows opened with lockCompact', () => {
		expect(shouldAllowCompactChange(true)).toBe(false);
	});

	it('allows compact changes for ordinary auxiliary windows', () => {
		expect(shouldAllowCompactChange(false)).toBe(true);
		expect(shouldAllowCompactChange(undefined)).toBe(true);
	});
});
