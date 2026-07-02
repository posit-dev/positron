/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { convertOutputsToLanguageModelParts } from '../../tools/notebookUtils.js';

/**
 * A small, valid SVG (raw XML text, as delivered by the notebook output
 * transport for image/svg+xml) with explicit dimensions.
 */
const VALID_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
	<rect width="200" height="100" fill="white"/>
	<path d="M 10 80 L 60 30 L 110 55 L 160 15" stroke="steelblue" fill="none" stroke-width="3"/>
</svg>`;

/** A second valid SVG with different dimensions, to pin scaling to the source size. */
const VALID_SVG_LARGER = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150">
	<circle cx="150" cy="75" r="50" fill="crimson"/>
</svg>`;

/** Data that no SVG rasterizer can render (not XML at all). */
const MALFORMED_SVG = 'this is not an svg document {{{';

/** A 1x1 red pixel PNG, base64-encoded (as delivered by the transport for image/png). */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

function assertIsPng(data: Uint8Array): void {
	assert.ok(data.length > PNG_SIGNATURE.length, 'image data should not be empty');
	for (let i = 0; i < PNG_SIGNATURE.length; i++) {
		assert.strictEqual(data[i], PNG_SIGNATURE[i], `PNG signature mismatch at byte ${i}`);
	}
}

/** Reads the image dimensions from a PNG IHDR chunk. */
function pngSize(data: Uint8Array): { width: number; height: number } {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

suite('convertOutputsToLanguageModelParts', () => {
	suite('SVG outputs (#12096)', () => {
		test('rasterizes an SVG output to a PNG image data part', async () => {
			const parts = await convertOutputsToLanguageModelParts([
				{ mimeType: 'image/svg+xml', data: VALID_SVG }
			]);

			assert.strictEqual(parts.length, 1);
			const part = parts[0];
			assert.ok(
				part instanceof vscode.LanguageModelDataPart,
				`expected a LanguageModelDataPart, got ${part.constructor.name}`
			);
			// The model can only see supported raster formats; image/svg+xml
			// data parts are dropped by every provider.
			assert.strictEqual(part.mimeType, 'image/png');
			assertIsPng(part.data);
		});

		test('rasterizes at 2x the source dimensions for legibility', async () => {
			const parts = await convertOutputsToLanguageModelParts([
				{ mimeType: 'image/svg+xml', data: VALID_SVG },
				{ mimeType: 'image/svg+xml', data: VALID_SVG_LARGER }
			]);

			assert.strictEqual(parts.length, 2);
			const first = parts[0] as vscode.LanguageModelDataPart;
			const second = parts[1] as vscode.LanguageModelDataPart;
			assertIsPng(first.data);
			assertIsPng(second.data);
			// Dimensions must derive from each SVG's own declared size.
			assert.deepStrictEqual(pngSize(first.data), { width: 400, height: 200 });
			assert.deepStrictEqual(pngSize(second.data), { width: 600, height: 300 });
		});

		test('rasterizes an SVG output whose MIME type carries parameters', async () => {
			const parts = await convertOutputsToLanguageModelParts([
				{ mimeType: 'image/svg+xml; charset=utf-8', data: VALID_SVG }
			]);

			assert.strictEqual(parts.length, 1);
			const part = parts[0];
			assert.ok(part instanceof vscode.LanguageModelDataPart);
			assert.strictEqual(part.mimeType, 'image/png');
			assertIsPng(part.data);
		});

		test('falls back to a text part when the SVG cannot be rasterized', async () => {
			const parts = await convertOutputsToLanguageModelParts([
				{ mimeType: 'image/svg+xml', data: MALFORMED_SVG }
			]);

			assert.strictEqual(parts.length, 1);
			const part = parts[0];
			assert.ok(
				part instanceof vscode.LanguageModelTextPart,
				'a failed rasterization must degrade to text, not throw or emit binary'
			);
			assert.ok(
				part.value.includes(MALFORMED_SVG),
				'fallback text should carry the raw SVG source'
			);
		});

		test('reports unavailable data for an SVG output with empty data', async () => {
			const parts = await convertOutputsToLanguageModelParts([
				{ mimeType: 'image/svg+xml', data: '' }
			]);

			assert.strictEqual(parts.length, 1);
			const part = parts[0];
			assert.ok(part instanceof vscode.LanguageModelTextPart);
			assert.strictEqual(part.value, '[Image data unavailable]');
		});
	});

	suite('non-SVG outputs (regression)', () => {
		test('converts a base64 PNG output to an image data part', async () => {
			const parts = await convertOutputsToLanguageModelParts([
				{ mimeType: 'image/png', data: PNG_BASE64 }
			]);

			assert.strictEqual(parts.length, 1);
			const part = parts[0];
			assert.ok(part instanceof vscode.LanguageModelDataPart);
			assert.strictEqual(part.mimeType, 'image/png');
			assertIsPng(part.data);
		});

		test('converts text outputs to text parts after a prefix', async () => {
			const parts = await convertOutputsToLanguageModelParts(
				[{ mimeType: 'text/plain', data: 'hello world' }],
				'Outputs:'
			);

			assert.strictEqual(parts.length, 2);
			assert.ok(parts[0] instanceof vscode.LanguageModelTextPart);
			assert.strictEqual((parts[0] as vscode.LanguageModelTextPart).value, 'Outputs:');
			assert.ok(parts[1] instanceof vscode.LanguageModelTextPart);
			assert.ok((parts[1] as vscode.LanguageModelTextPart).value.includes('hello world'));
		});
	});
});
