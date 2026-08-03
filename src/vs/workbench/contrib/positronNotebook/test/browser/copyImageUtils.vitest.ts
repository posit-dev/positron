/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { isCopyImageMenuArg } from '../../browser/copyImageUtils.js';

// The base64 normalization these tests used to cover now lives in
// services/positronPlots/common/imageDataUrl.ts as toBase64ImageDataUrl,
// shared with the plots service; see imageDataUrl.vitest.ts.
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
