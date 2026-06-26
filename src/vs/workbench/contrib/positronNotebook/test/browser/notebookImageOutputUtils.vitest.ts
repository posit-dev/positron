/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer, encodeBase64 } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import {
	defaultImageFileName,
	imageBytesFromDataUrl,
	imageExtensionFromDataUrl,
} from '../../browser/notebookImageOutputUtils.js';

describe('notebookImageOutputUtils', () => {
	createTestContainer().build();

	describe('imageExtensionFromDataUrl', () => {
		it('returns .png for png data URLs', () => {
			expect(imageExtensionFromDataUrl('data:image/png;base64,abc')).toBe('.png');
		});

		it('returns .svg for svg data URLs', () => {
			expect(imageExtensionFromDataUrl('data:image/svg+xml,%3Csvg%3E')).toBe('.svg');
		});

		it('returns .jpg for jpeg data URLs', () => {
			expect(imageExtensionFromDataUrl('data:image/jpeg;base64,abc')).toBe('.jpg');
		});

		it('returns .gif for gif data URLs', () => {
			expect(imageExtensionFromDataUrl('data:image/gif;base64,abc')).toBe('.gif');
		});

		it('returns .webp for webp data URLs', () => {
			expect(imageExtensionFromDataUrl('data:image/webp;base64,abc')).toBe('.webp');
		});

		it('defaults to .png for unknown MIME types', () => {
			expect(imageExtensionFromDataUrl('data:application/octet-stream;base64,abc')).toBe('.png');
			expect(imageExtensionFromDataUrl('not-a-data-url')).toBe('.png');
		});
	});

	describe('imageBytesFromDataUrl', () => {
		it('decodes a base64 PNG data URL', () => {
			const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
			const dataUrl = `data:image/png;base64,${encodeBase64(VSBuffer.wrap(bytes))}`;
			const result = imageBytesFromDataUrl(dataUrl);
			expect(result).toBeDefined();
			expect(Array.from(result!)).toEqual(Array.from(bytes));
		});

		it('decodes a URL-encoded SVG data URL', () => {
			const svg = '<svg><circle r="10"/></svg>';
			const dataUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;
			const result = imageBytesFromDataUrl(dataUrl);
			expect(result).toBeDefined();
			expect(VSBuffer.wrap(result!).toString()).toBe(svg);
		});

		it('returns undefined for a malformed data URL', () => {
			expect(imageBytesFromDataUrl('data:image/png')).toBeUndefined();
		});
	});

	describe('defaultImageFileName', () => {
		it('builds <docNameNoExt>_cell<index><ext>', () => {
			const uri = URI.file('/home/user/analysis.ipynb');
			expect(defaultImageFileName(uri, 2, '.png')).toBe('analysis_cell2.png');
		});

		it('handles documents without an extension', () => {
			const uri = URI.file('/home/user/notebook');
			expect(defaultImageFileName(uri, 0, '.svg')).toBe('notebook_cell0.svg');
		});
	});
});
