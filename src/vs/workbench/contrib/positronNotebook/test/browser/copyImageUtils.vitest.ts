/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isCopyImageMenuArg, toBase64DataUrl } from '../../browser/copyImageUtils.js';

describe('copyImageUtils', () => {
	describe('toBase64DataUrl', () => {
		it('returns already-base64 data URLs unchanged', () => {
			const url = 'data:image/png;base64,iVBORw0KGgo=';
			expect(toBase64DataUrl(url)).toBe(url);
		});

		it('returns data URLs with no comma unchanged', () => {
			const url = 'data:image/png';
			expect(toBase64DataUrl(url)).toBe(url);
		});

		it('converts URL-encoded SVG data URL to base64', () => {
			const svg = '<svg><circle r="10"/></svg>';
			const input = `data:image/svg+xml,${encodeURIComponent(svg)}`;
			const result = toBase64DataUrl(input);
			expect(result.startsWith('data:image/svg+xml;base64,')).toBeTruthy();
			expect(!result.includes('%3C')).toBeTruthy();
		});

		it('handles raw SVG payload with literal percent signs', () => {
			// Literal '%' that is not valid URL-encoding should not throw
			const input = 'data:image/svg+xml,<text>100% done</text>';
			const result = toBase64DataUrl(input);
			expect(result.startsWith('data:image/svg+xml;base64,')).toBeTruthy();
		});

		it('handles SVG with Unicode characters', () => {
			const svg = '<svg><text>\u00e9\u00e0\u00fc</text></svg>';
			const input = `data:image/svg+xml,${encodeURIComponent(svg)}`;
			const result = toBase64DataUrl(input);
			expect(result.startsWith('data:image/svg+xml;base64,')).toBeTruthy();
		});
	});

	describe('isCopyImageMenuArg', () => {
		it('returns true for valid arg', () => {
			expect(isCopyImageMenuArg({ imageDataUrl: 'data:image/png;base64,abc' })).toBeTruthy();
		});

		it('returns false for null', () => {
			expect(!isCopyImageMenuArg(null)).toBeTruthy();
		});

		it('returns false for missing imageDataUrl', () => {
			expect(!isCopyImageMenuArg({ other: 'value' })).toBeTruthy();
		});

		it('returns false for non-string imageDataUrl', () => {
			expect(!isCopyImageMenuArg({ imageDataUrl: 123 })).toBeTruthy();
		});
	});
});
