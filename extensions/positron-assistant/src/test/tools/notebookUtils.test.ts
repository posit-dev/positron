/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { convertOutputsToLanguageModelParts, isImageMime } from '../../tools/notebookUtils.js';

/**
 * Positron core rasterizes SVG notebook outputs to PNG before they reach the
 * extension (see core's $getCellOutputs, #12096). image/svg+xml therefore only
 * arrives here as raw XML text, when core's rasterization failed; it must be
 * passed through as text, never base64-decoded as binary image data.
 */
const RAW_SVG_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
	<rect width="200" height="100" fill="white"/>
</svg>`;

/** A 1x1 red pixel PNG, base64-encoded (as delivered by the transport for image/png). */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

function assertIsPng(data: Uint8Array): void {
	assert.ok(data.length > PNG_SIGNATURE.length, 'image data should not be empty');
	for (let i = 0; i < PNG_SIGNATURE.length; i++) {
		assert.strictEqual(data[i], PNG_SIGNATURE[i], `PNG signature mismatch at byte ${i}`);
	}
}

suite('convertOutputsToLanguageModelParts', () => {
	suite('SVG fallback outputs (#12096)', () => {
		test('passes raw SVG text through as a text part', () => {
			const parts = convertOutputsToLanguageModelParts([
				{ mimeType: 'image/svg+xml', data: RAW_SVG_TEXT }
			]);

			assert.strictEqual(parts.length, 1);
			const part = parts[0];
			assert.ok(
				part instanceof vscode.LanguageModelTextPart,
				'raw SVG must become text, not a base64-decoded data part'
			);
			assert.ok(
				part.value.includes(RAW_SVG_TEXT),
				'the text part should carry the SVG source'
			);
		});

		test('treats an SVG MIME type with parameters as text', () => {
			const parts = convertOutputsToLanguageModelParts([
				{ mimeType: 'image/svg+xml; charset=utf-8', data: RAW_SVG_TEXT }
			]);

			assert.strictEqual(parts.length, 1);
			assert.ok(parts[0] instanceof vscode.LanguageModelTextPart);
		});
	});

	suite('non-SVG outputs (regression)', () => {
		test('converts a base64 PNG output to an image data part', () => {
			const parts = convertOutputsToLanguageModelParts([
				{ mimeType: 'image/png', data: PNG_BASE64 }
			]);

			assert.strictEqual(parts.length, 1);
			const part = parts[0];
			assert.ok(part instanceof vscode.LanguageModelDataPart);
			assert.strictEqual(part.mimeType, 'image/png');
			assertIsPng(part.data);
		});

		test('converts text outputs to text parts after a prefix', () => {
			const parts = convertOutputsToLanguageModelParts(
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

suite('isImageMime', () => {
	test('classifies binary image types as images and SVG as not', () => {
		assert.deepStrictEqual(
			{
				png: isImageMime('image/png'),
				jpeg: isImageMime('image/jpeg'),
				svg: isImageMime('image/svg+xml'),
				svgWithParams: isImageMime('image/svg+xml; charset=utf-8'),
				text: isImageMime('text/plain'),
			},
			{
				png: true,
				jpeg: true,
				svg: false,
				svgWithParams: false,
				text: false,
			}
		);
	});
});
