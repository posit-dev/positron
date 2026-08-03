/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer, encodeBase64 } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { getImageOutputName } from '../../../../contrib/positronNotebook/common/imageOutputUtils.js';
import { StaticPlotClient } from '../../common/staticPlotClient.js';

const pngDataUrl = `data:image/png;base64,${encodeBase64(VSBuffer.fromString('fake-png-bytes'))}`;

describe('StaticPlotClient.fromDataUrl', () => {
	let storageService: TestStorageService;

	beforeEach(() => {
		storageService = new TestStorageService();
	});

	afterEach(() => {
		storageService.dispose();
	});

	it('suggests the caller-supplied name when saving', () => {
		const plot = StaticPlotClient.fromDataUrl(storageService, pngDataUrl, 'notebook_cell1');

		expect(plot?.metadata.suggested_file_name).toBe('notebook_cell1');
	});

	it('suggests the same name the direct save action would default to', () => {
		// A popped-out output and a directly saved output should seed the save
		// dialog identically; the extension is added from the image MIME type.
		const name = getImageOutputName(URI.file('/home/user/project/12841.ipynb'), 0);
		const plot = StaticPlotClient.fromDataUrl(storageService, pngDataUrl, name);

		expect(plot?.metadata.suggested_file_name).toBe('12841_cell1');
	});

	it('falls back to a generated plot name when unnamed', () => {
		const plot = StaticPlotClient.fromDataUrl(storageService, pngDataUrl);

		expect(plot?.metadata.suggested_file_name).toMatch(/^plot-\d+$/);
	});

	it('does not advance the shared plot counter for a named plot', () => {
		StaticPlotClient.fromDataUrl(storageService, pngDataUrl, 'notebook_cell1');
		const unnamed = StaticPlotClient.fromDataUrl(storageService, pngDataUrl);

		// The named popout must not consume plot-1 from the plots pane's numbering.
		expect(unnamed?.metadata.suggested_file_name).toBe('plot-1');
	});

	it('gives each call a distinct id so repeat popouts are independent', () => {
		const first = StaticPlotClient.fromDataUrl(storageService, pngDataUrl, 'notebook_cell1');
		const second = StaticPlotClient.fromDataUrl(storageService, pngDataUrl, 'notebook_cell1');

		expect(first?.id).not.toBe(second?.id);
	});

	it('returns undefined for a malformed data URL', () => {
		expect(StaticPlotClient.fromDataUrl(storageService, 'not-a-data-url')).toBeUndefined();
	});
});
