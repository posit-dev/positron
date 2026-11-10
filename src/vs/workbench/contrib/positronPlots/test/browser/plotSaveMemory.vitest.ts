/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { EphemeralStateService } from '../../../../../platform/ephemeralState/common/ephemeralStateService.js';
import { PlotRenderFormat } from '../../../../services/positronPlots/common/positronPlots.js';
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
		expect((await memory.getDirectory(fallback)).toString()).toBe(fallback.toString());
		expect(await memory.getFormat()).toBeUndefined();
	});

	it('returns the last saved folder and format', async () => {
		await memoryFor('ws1').remember(figures, PlotRenderFormat.Pdf);

		const memory = memoryFor('ws1');
		expect((await memory.getDirectory(fallback)).toString()).toBe(figures.toString());
		expect(await memory.getFormat()).toBe(PlotRenderFormat.Pdf);
	});

	it('updates the folder but keeps the previous format when a save has no format', async () => {
		const memory = memoryFor('ws1');
		await memory.remember(figures, PlotRenderFormat.Svg);
		await memory.remember(fallback);
		existing.add(fallback.toString());
		expect((await memory.getDirectory(URI.file('/elsewhere'))).toString()).toBe(fallback.toString());
		expect(await memory.getFormat()).toBe(PlotRenderFormat.Svg);
	});

	it('falls back when the saved folder no longer exists', async () => {
		const memory = memoryFor('ws1');
		await memory.remember(figures, PlotRenderFormat.Png);
		existing.delete(figures.toString());
		expect((await memory.getDirectory(fallback)).toString()).toBe(fallback.toString());
	});

	it('falls back when the saved folder has been replaced by a file', async () => {
		const memory = memoryFor('ws1');
		await memory.remember(figures, PlotRenderFormat.Png);
		files.add(figures.toString());
		expect((await memory.getDirectory(fallback)).toString()).toBe(fallback.toString());
	});

	it('uses the defaults when the saved state cannot be read', async () => {
		const failing = { getItem: async () => { throw new Error('no remote connection'); }, setItem: async () => { } };
		const memory = new PlotSaveMemory(failing, fileService, 'ws1');
		expect((await memory.getDirectory(fallback)).toString()).toBe(fallback.toString());
		expect(await memory.getFormat()).toBeUndefined();
	});

	it('keeps each workspace separate', async () => {
		await memoryFor('ws1').remember(figures, PlotRenderFormat.Pdf);

		const other = memoryFor('ws2');
		expect((await other.getDirectory(fallback)).toString()).toBe(fallback.toString());
		expect(await other.getFormat()).toBeUndefined();
	});
});
