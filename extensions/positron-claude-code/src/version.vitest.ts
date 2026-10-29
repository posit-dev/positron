/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { isAtLeast } from './version';

describe('isAtLeast', () => {
	it('compares each part numerically, ignoring any prerelease suffix', () => {
		expect([
			isAtLeast('2.0.35', '2.0.35'),
			isAtLeast('2.1.3', '2.0.35'),
			isAtLeast('2.0.35-beta.1', '2.0.35'),
			isAtLeast('2.0.34', '2.0.35'),
			isAtLeast('1.10.0', '1.9.0'),
			isAtLeast('2', '2.0.0'),
			isAtLeast('', '2.0.35'),
		]).toEqual([true, true, true, false, true, true, false]);
	});
});
