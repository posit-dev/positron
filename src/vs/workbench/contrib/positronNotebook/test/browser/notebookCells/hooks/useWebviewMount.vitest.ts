/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { computeBoundedHeight } from '../../../../browser/notebookCells/hooks/useWebviewMount.js';

describe('computeBoundedHeight', () => {
	it('caps the height at 1000px when output scrolling is enabled', () => {
		expect(computeBoundedHeight(2000, true)).toBe(1000);
	});

	it('leaves the height uncapped when output scrolling is disabled', () => {
		expect(computeBoundedHeight(2000, false)).toBe(2000);
	});

	it('does not cap content shorter than the limit', () => {
		expect(computeBoundedHeight(300, true)).toBe(300);
	});

	it('collapses the default 150px empty-output height to 0', () => {
		expect(computeBoundedHeight(150, true)).toBe(0);
		expect(computeBoundedHeight(150, false)).toBe(0);
	});
});
