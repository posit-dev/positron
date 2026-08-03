/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer, encodeBase64 } from '../../../../../base/common/buffer.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { decodeImageDataUrl, toBase64ImageDataUrl } from '../../common/imageDataUrl.js';
import { StaticPlotClient } from '../../common/staticPlotClient.js';

/**
 * A cell image output reaches the user through several paths: "Save Image As...",
 * "Copy Image", and "Open Output in New Tab" followed by the plot editor's own
 * save or copy. Notebook and Quarto outputs also differ in encoding - PNG
 * outputs are base64, SVG outputs are URL-encoded - and the popout path
 * re-encodes through `StaticPlotClient.uri`.
 *
 * These tests pin all of those paths to identical bytes, so a change to one
 * encoding step cannot silently corrupt or break another path.
 */
describe('image output round-trip', () => {
	let storageService: TestStorageService;

	beforeEach(() => {
		storageService = new TestStorageService();
	});

	afterEach(() => {
		storageService.dispose();
	});

	/** The bytes the plot editor's "Save Plot" would write for a popped-out output. */
	function bytesViaPopout(dataUrl: string): string | undefined {
		const plot = StaticPlotClient.fromDataUrl(storageService, dataUrl, { name: 'notebook_cell1' });
		// The plot editor saves from plotClient.uri, not the original data URL.
		return plot && decodeImageDataUrl(plot.uri)?.data.toString();
	}

	/** The bytes the direct "Save Image As..." action would write. */
	function bytesViaDirectSave(dataUrl: string): string | undefined {
		return decodeImageDataUrl(dataUrl)?.data.toString();
	}

	describe('base64 PNG output', () => {
		const png = 'fake-png-bytes';
		const dataUrl = `data:image/png;base64,${encodeBase64(VSBuffer.fromString(png))}`;

		it('saves the same bytes directly and via popout', () => {
			expect(bytesViaDirectSave(dataUrl)).toBe(png);
			expect(bytesViaPopout(dataUrl)).toBe(png);
		});

		it('copies the same bytes directly and via popout', () => {
			const plot = StaticPlotClient.fromDataUrl(storageService, dataUrl, { name: 'notebook_cell1' });
			expect(decodeImageDataUrl(toBase64ImageDataUrl(dataUrl))?.data.toString()).toBe(png);
			expect(decodeImageDataUrl(toBase64ImageDataUrl(plot!.uri))?.data.toString()).toBe(png);
		});
	});

	describe('URL-encoded SVG output', () => {
		// Includes a '+' and a '%', both of which are encoding hazards.
		const svg = '<svg><text>a + b, 100% done</text></svg>';
		const dataUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;

		it('saves the same markup directly and via popout', () => {
			expect(bytesViaDirectSave(dataUrl)).toBe(svg);
			expect(bytesViaPopout(dataUrl)).toBe(svg);
		});

		it('copies the same markup directly and via popout', () => {
			const plot = StaticPlotClient.fromDataUrl(storageService, dataUrl, { name: 'notebook_cell1' });
			expect(decodeImageDataUrl(toBase64ImageDataUrl(dataUrl))?.data.toString()).toBe(svg);
			expect(decodeImageDataUrl(toBase64ImageDataUrl(plot!.uri))?.data.toString()).toBe(svg);
		});

		it('produces a base64 data URL for the clipboard, which only accepts base64', () => {
			const plot = StaticPlotClient.fromDataUrl(storageService, dataUrl, { name: 'notebook_cell1' });
			// StaticPlotClient.uri emits 'data:image/svg+xml;utf8,...' for SVG.
			expect(plot!.uri).not.toContain(';base64,');
			expect(toBase64ImageDataUrl(plot!.uri)).toContain(';base64,');
		});

		it('keeps the SVG MIME type through the popout, so the save dialog offers .svg', () => {
			const plot = StaticPlotClient.fromDataUrl(storageService, dataUrl, { name: 'notebook_cell1' });
			expect(decodeImageDataUrl(plot!.uri)?.mimeType).toBe('image/svg+xml');
		});
	});
});
