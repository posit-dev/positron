/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer, encodeBase64 } from '../../../../../base/common/buffer.js';
import { decodeImageDataUrl, getImageContentId, getImageDataUrl, getImageExtensionForMimeType, parseImageDataUrl, toBase64ImageDataUrl } from '../../common/imageDataUrl.js';

const pngDataUrl = `data:image/png;base64,${encodeBase64(VSBuffer.fromString('fake-png-bytes'))}`;
const svg = '<svg><circle r="10"/></svg>';
const svgDataUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;

describe('imageDataUrl', () => {
	describe('parseImageDataUrl', () => {
		it('keeps a base64 payload encoded', () => {
			expect(parseImageDataUrl(pngDataUrl)).toMatchInlineSnapshot(`
				{
				  "base64": true,
				  "data": "ZmFrZS1wbmctYnl0ZXM=",
				  "mimeType": "image/png",
				}
			`);
		});

		it('URL-decodes an SVG payload', () => {
			expect(parseImageDataUrl(svgDataUrl)).toMatchInlineSnapshot(`
				{
				  "base64": false,
				  "data": "<svg><circle r="10"/></svg>",
				  "mimeType": "image/svg+xml",
				}
			`);
		});

		it('keeps a raw payload with literal percent signs', () => {
			expect(parseImageDataUrl('data:image/svg+xml,<text>100% done</text>')?.data)
				.toBe('<text>100% done</text>');
		});

		it('URL-decodes the ;utf8 form emitted by StaticPlotClient.uri', () => {
			expect(parseImageDataUrl(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`)).toMatchInlineSnapshot(`
				{
				  "base64": false,
				  "data": "<svg><circle r="10"/></svg>",
				  "mimeType": "image/svg+xml",
				}
			`);
		});

		it('ignores parameters other than base64', () => {
			expect(parseImageDataUrl('data:image/svg+xml;charset=utf-8,<svg/>')?.data).toBe('<svg/>');
		});

		it('returns undefined for a malformed data URL', () => {
			expect(parseImageDataUrl('not-a-data-url')).toBeUndefined();
		});

		it('returns undefined for a data URL with no payload separator', () => {
			expect(parseImageDataUrl('data:image/png')).toBeUndefined();
		});

		it('returns undefined when the MIME type is missing', () => {
			expect(parseImageDataUrl('data:,<svg/>')).toBeUndefined();
		});
	});

	describe('decodeImageDataUrl', () => {
		it('decodes a base64 PNG data URL to bytes', () => {
			const decoded = decodeImageDataUrl(pngDataUrl);
			expect(decoded?.mimeType).toBe('image/png');
			expect(decoded?.data.toString()).toBe('fake-png-bytes');
		});

		it('decodes a URL-encoded SVG data URL to bytes', () => {
			const decoded = decodeImageDataUrl(svgDataUrl);
			expect(decoded?.mimeType).toBe('image/svg+xml');
			expect(decoded?.data.toString()).toBe(svg);
		});

		it('returns undefined for a malformed data URL', () => {
			expect(decodeImageDataUrl('not-a-data-url')).toBeUndefined();
		});
	});

	// Kernels provide raster image payloads as base64 and SVG payloads as raw
	// markup. Both formats must produce data URLs supported by the decoder.
	describe('getImageDataUrl', () => {
		it('URL-encodes an SVG payload rather than labelling it base64', () => {
			expect(getImageDataUrl('image/svg+xml', svg)).toBe(svgDataUrl);
		});

		it('produces an SVG data URL the decoder round-trips', () => {
			const decoded = decodeImageDataUrl(getImageDataUrl('image/svg+xml', svg));
			expect({ mimeType: decoded?.mimeType, data: decoded?.data.toString() })
				.toEqual({ mimeType: 'image/svg+xml', data: svg });
		});

		it('labels a raster payload as base64', () => {
			expect(getImageDataUrl('image/png', 'aGVsbG8=')).toBe('data:image/png;base64,aGVsbG8=');
		});

		it('returns a payload that is already a data URL unchanged', () => {
			expect(getImageDataUrl('image/png', pngDataUrl)).toBe(pngDataUrl);
		});
	});

	describe('toBase64ImageDataUrl', () => {
		it('returns an already-base64 data URL unchanged', () => {
			expect(toBase64ImageDataUrl(pngDataUrl)).toBe(pngDataUrl);
		});

		it('returns an unparseable data URL unchanged', () => {
			// No comma, so there is no payload to re-encode; let the clipboard reject it.
			expect(toBase64ImageDataUrl('data:image/png')).toBe('data:image/png');
		});

		it('converts a URL-encoded SVG data URL to base64', () => {
			const result = toBase64ImageDataUrl(svgDataUrl);
			expect(result.startsWith('data:image/svg+xml;base64,')).toBe(true);
			expect(result).not.toContain('%3C');
			expect(decodeImageDataUrl(result)?.data.toString()).toBe(svg);
		});

		it('converts the ;utf8 SVG form to base64', () => {
			const result = toBase64ImageDataUrl(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
			expect(result.startsWith('data:image/svg+xml;base64,')).toBe(true);
			expect(decodeImageDataUrl(result)?.data.toString()).toBe(svg);
		});

		it('handles a raw SVG payload with literal percent signs', () => {
			const result = toBase64ImageDataUrl('data:image/svg+xml,<text>100% done</text>');
			expect(decodeImageDataUrl(result)?.data.toString()).toBe('<text>100% done</text>');
		});

		it('handles SVG with non-ASCII characters', () => {
			const unicodeSvg = '<svg><text>éàü</text></svg>';
			const result = toBase64ImageDataUrl(`data:image/svg+xml,${encodeURIComponent(unicodeSvg)}`);
			expect(decodeImageDataUrl(result)?.data.toString()).toBe(unicodeSvg);
		});
	});

	describe('getImageContentId', () => {
		/** A large payload, past the point where only the ends are sampled. */
		const largeDataUrl = (body: string) => `data:image/png;base64,${body}`;
		const largeHead = 'h'.repeat(2000);
		const largeTail = 't'.repeat(2000);

		it('is stable for the same image and key, so a repeat popout reuses the tab', () => {
			expect(getImageContentId(pngDataUrl, 'notebook_cell1'))
				.toBe(getImageContentId(pngDataUrl, 'notebook_cell1'));
		});

		it('differs when the image changes, so a re-run opens a new tab', () => {
			const rerun = `data:image/png;base64,${encodeBase64(VSBuffer.fromString('different-bytes'))}`;
			expect(getImageContentId(rerun, 'notebook_cell1'))
				.not.toBe(getImageContentId(pngDataUrl, 'notebook_cell1'));
		});

		it('differs by key for identical images, so two documents get a tab each', () => {
			// Two notebooks that share a basename produce the same label for the same
			// cell, and the same plot is byte-identical: only the key separates them.
			expect(getImageContentId(pngDataUrl, 'file:///a/nb.ipynb\nnb_cell1'))
				.not.toBe(getImageContentId(pngDataUrl, 'file:///b/nb.ipynb\nnb_cell1'));
		});

		it('differs for a large image when its trailing bytes change', () => {
			expect(getImageContentId(largeDataUrl(largeHead + largeTail), 'k'))
				.not.toBe(getImageContentId(largeDataUrl(largeHead + 'x'.repeat(2000)), 'k'));
		});

		it('differs for a large image when only its length changes', () => {
			expect(getImageContentId(largeDataUrl(largeHead + largeTail), 'k'))
				.not.toBe(getImageContentId(largeDataUrl(largeHead + 'm' + largeTail), 'k'));
		});

		it('samples only the ends of a large payload', () => {
			// Deliberate: hashing megabytes per popout is not worth it when a collision
			// only means reusing a tab that holds an equivalent image. Two payloads of
			// the same length that agree on both ends are treated as the same image.
			expect(getImageContentId(largeDataUrl(`${largeHead}AAA${largeTail}`), 'k'))
				.toBe(getImageContentId(largeDataUrl(`${largeHead}BBB${largeTail}`), 'k'));
		});
	});

	describe('getImageExtensionForMimeType', () => {
		it('maps known image MIME types', () => {
			expect(getImageExtensionForMimeType('image/png')).toBe('.png');
			expect(getImageExtensionForMimeType('image/svg+xml')).toBe('.svg');
		});

		it('defaults to .png for an unknown MIME type', () => {
			expect(getImageExtensionForMimeType('image/unknown-format')).toBe('.png');
		});
	});
});
