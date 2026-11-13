/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../../base/common/network.js';
import { dirname, joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileDialogService, ISaveDialogOptions } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronPlotsService } from '../../browser/positronPlotsService.js';

describe('PositronPlotsService - save plot folder', () => {
	const home = URI.file('/home');
	const figures = URI.file('/ws/figures');
	const pngDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
	const showSaveDialog = vi.fn<(options: ISaveDialogOptions) => Promise<URI | undefined>>();

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IFileDialogService, { defaultFilePath: async () => home, showSaveDialog })
		.build();
	let plotsService: PositronPlotsService;

	beforeEach(async () => {
		// A real file service, so the saved folder can be checked for existence.
		const fileService = ctx.disposables.add(new FileService(new NullLogService()));
		ctx.disposables.add(fileService.registerProvider(Schemas.file, ctx.disposables.add(new InMemoryFileSystemProvider())));
		await fileService.createFolder(figures);
		ctx.instantiationService.stub(IFileService, fileService);
		plotsService = ctx.disposables.add(ctx.instantiationService.createInstance(PositronPlotsService));
	});

	/** Saves a static plot to `target` (undefined cancels) and returns the folder the dialog suggested. */
	async function save(target: URI | undefined): Promise<string> {
		let suggested = '';
		showSaveDialog.mockImplementationOnce(async options => {
			suggested = dirname(options.defaultUri!).toString();
			return target;
		});
		await plotsService.showSavePlotDialog(pngDataUrl);
		return suggested;
	}

	it('suggests the folder of the last successful save', async () => {
		expect(await save(joinPath(figures, 'plot.png'))).toBe(home.toString());
		expect(await save(undefined)).toBe(figures.toString());
	});

	it('keeps the remembered folder when a save fails to write', async () => {
		await save(joinPath(figures, 'plot.png'));
		await save(URI.file('/ws/missing/plot.png'));
		expect(await save(undefined)).toBe(figures.toString());
	});
});
