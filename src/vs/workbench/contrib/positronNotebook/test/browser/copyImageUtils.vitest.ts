/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { isCopyImageMenuArg } from '../../browser/copyImageUtils.js';

// Base64 normalization is tested with the shared image-data-URL helpers.
describe('copyImageUtils', () => {
	createTestContainer().build();

	describe('isCopyImageMenuArg', () => {
		it('returns true for valid arg', () => {
			expect(isCopyImageMenuArg({ imageDataUrl: 'data:image/png;base64,abc' })).toBe(true);
		});

		it('returns false for null', () => {
			expect(isCopyImageMenuArg(null)).toBe(false);
		});

		it('returns false for missing imageDataUrl', () => {
			expect(isCopyImageMenuArg({ other: 'value' })).toBe(false);
		});

		it('returns false for non-string imageDataUrl', () => {
			expect(isCopyImageMenuArg({ imageDataUrl: 123 })).toBe(false);
		});
	});
});
