/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { EphemeralStateService } from '../../../../../platform/ephemeralState/common/ephemeralStateService.js';
import { PlotRenderFormat } from '../../../../services/positronPlots/common/positronPlots.js';
import { PdfSizeChoice } from '../../browser/modalDialogs/pdfPageSize.js';
import { PlotSaveMemory, PlotSaveMemoryFileService } from '../../browser/plotSaveMemory.js';

describe('PlotSaveMemory', () => {
	const fallback = URI.file('/workspace');
	const figures = URI.file('/workspace/figures');

	let ephemeralState: EphemeralStateService;
	let existing: Set<string>;
	let files: Set<string>;
	let fileService: PlotSaveMemoryFileService;

	beforeEach(() => {
		ephemeralState = new EphemeralStateService();
		existing = new Set([figures.toString()]);
		files = new Set();
		fileService = {
			stat: async (uri: URI) => {
				if (!existing.has(uri.toString())) {
					throw new Error('not found');
				}
				return { isDirectory: !files.has(uri.toString()) };
			},
		};
	});

	const memoryFor = (workspaceId: string) => new PlotSaveMemory(ephemeralState, fileService, workspaceId);

	it('uses the fallback folder and no format before anything is saved', async () => {
		const memory = memoryFor('ws1');
		expect((await memory.get(fallback)).directory.toString()).toBe(fallback.toString());
		expect((await memory.get(fallback)).format).toBeUndefined();
	});

	it('returns the last saved folder and format', async () => {
		await memoryFor('ws1').remember(figures, { format: PlotRenderFormat.Pdf });

		const memory = memoryFor('ws1');
		expect((await memory.get(fallback)).directory.toString()).toBe(figures.toString());
		expect((await memory.get(fallback)).format).toBe(PlotRenderFormat.Pdf);
	});

	it('updates the folder but keeps the previous format when a save has no format', async () => {
		const plots = URI.file('/workspace/plots');
		existing.add(plots.toString());
		const memory = memoryFor('ws1');
		await memory.remember(figures, { format: PlotRenderFormat.Svg });
		await memory.remember(plots, {});
		expect((await memory.get(fallback)).directory.toString()).toBe(plots.toString());
		expect((await memory.get(fallback)).format).toBe(PlotRenderFormat.Svg);
	});

	it('has no resolution before anything is saved', async () => {
		expect((await memoryFor('ws1').get(fallback)).resolution).toBeUndefined();
	});

	it('returns the last saved resolution', async () => {
		await memoryFor('ws1').remember(figures, { format: PlotRenderFormat.Png, resolution: 3 });
		expect((await memoryFor('ws1').get(fallback)).resolution).toBe(3);
	});

	it('keeps the previous resolution when a save has none', async () => {
		const memory = memoryFor('ws1');
		await memory.remember(figures, { format: PlotRenderFormat.Png, resolution: 3 });
		await memory.remember(figures, { format: PlotRenderFormat.Svg });
		expect(await memory.get(fallback)).toMatchObject({ format: PlotRenderFormat.Svg, resolution: 3 });
	});

	it('falls back when the saved folder no longer exists', async () => {
		const memory = memoryFor('ws1');
		await memory.remember(figures, { format: PlotRenderFormat.Png });
		existing.delete(figures.toString());
		expect((await memory.get(fallback)).directory.toString()).toBe(fallback.toString());
	});

	it('falls back when the saved folder has been replaced by a file', async () => {
		const memory = memoryFor('ws1');
		await memory.remember(figures, { format: PlotRenderFormat.Png });
		files.add(figures.toString());
		expect((await memory.get(fallback)).directory.toString()).toBe(fallback.toString());
	});

	it('uses the defaults when the saved state cannot be read', async () => {
		const failing = { getItem: async () => { throw new Error('no remote connection'); }, setItem: async () => { } };
		const memory = new PlotSaveMemory(failing, fileService, 'ws1');
		expect((await memory.get(fallback)).directory.toString()).toBe(fallback.toString());
		expect((await memory.get(fallback)).format).toBeUndefined();
	});

	it('does not fail when the saved state cannot be written', async () => {
		const failing = { getItem: async () => undefined, setItem: async () => { throw new Error('no remote connection'); } };
		const memory = new PlotSaveMemory(failing, fileService, 'ws1');
		await expect(memory.remember(figures, { format: PlotRenderFormat.Png })).resolves.toBeUndefined();
	});

	it('keeps each workspace separate', async () => {
		await memoryFor('ws1').remember(figures, { format: PlotRenderFormat.Pdf });

		const other = memoryFor('ws2');
		expect((await other.get(fallback)).directory.toString()).toBe(fallback.toString());
		expect((await other.get(fallback)).format).toBeUndefined();
	});

	describe('pdfSize', () => {
		const letter: PdfSizeChoice = { preset: 'letter', orientation: 'landscape' };

		it('returns the last saved PDF size', async () => {
			await memoryFor('ws1').remember(figures, { format: PlotRenderFormat.Pdf, pdfSize: letter });
			expect((await memoryFor('ws1').get(fallback)).pdfSize).toEqual(letter);
		});

		it('returns a custom PDF size with its dimensions', async () => {
			const custom: PdfSizeChoice = { preset: 'custom', orientation: 'portrait', width: 5, height: 7 };
			await memoryFor('ws1').remember(figures, { pdfSize: custom });
			expect((await memoryFor('ws1').get(fallback)).pdfSize).toEqual(custom);
		});

		it('keeps the previous PDF size when a save has none', async () => {
			const memory = memoryFor('ws1');
			await memory.remember(figures, { format: PlotRenderFormat.Pdf, pdfSize: letter });
			await memory.remember(figures, { format: PlotRenderFormat.Png });
			expect(await memory.get(fallback)).toMatchObject({ format: PlotRenderFormat.Png, pdfSize: letter });
		});

		it('has no PDF size for an entry saved before PDF sizes were remembered', async () => {
			await ephemeralState.setItem('positron.plots.lastSaveLocation.ws1', { directory: figures.toString(), format: PlotRenderFormat.Pdf });
			expect((await memoryFor('ws1').get(fallback)).pdfSize).toBeUndefined();
		});

		it.each([
			['unknown preset', { preset: 'tabloid', orientation: 'portrait' }],
			['bad orientation', { preset: 'letter', orientation: 'sideways' }],
			['custom without dimensions', { preset: 'custom', orientation: 'portrait' }],
			['custom with zero width', { preset: 'custom', orientation: 'portrait', width: 0, height: 5 }],
			['custom with non-finite height', { preset: 'custom', orientation: 'portrait', width: 5, height: Infinity }],
			['not an object', 'letter'],
		])('ignores a malformed PDF size: %s', async (_name, pdfSize) => {
			await ephemeralState.setItem('positron.plots.lastSaveLocation.ws1', { directory: figures.toString(), pdfSize });
			expect((await memoryFor('ws1').get(fallback)).pdfSize).toBeUndefined();
		});
	});
});
