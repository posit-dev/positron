/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer, encodeBase64 } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IPositronPlotsService } from '../../../../services/positronPlots/common/positronPlots.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { getDefaultImageFilename, getImageOutputName, openImageOutputInNewTab, saveImageOutput } from '../../common/imageOutputUtils.js';

const notebookUri = URI.file('/home/user/project/notebook.ipynb');
const pngDataUrl = `data:image/png;base64,${encodeBase64(VSBuffer.fromString('fake-png-bytes'))}`;

describe('imageOutputUtils', () => {
	createTestContainer().build();

	const logService = new NullLogService();

	describe('getImageOutputName', () => {
		it('derives a 1-based cell name from the document name', () => {
			expect(getImageOutputName(notebookUri, 0)).toBe('notebook_cell1');
			expect(getImageOutputName(notebookUri, 2)).toBe('notebook_cell3');
		});
	});

	describe('getDefaultImageFilename', () => {
		it('derives the filename from the notebook name, cell number, and MIME type', () => {
			expect(getDefaultImageFilename(notebookUri, 0, 'image/png')).toBe('notebook_cell1.png');
			expect(getDefaultImageFilename(notebookUri, 2, 'image/svg+xml')).toBe('notebook_cell3.svg');
		});
	});

	describe('saveImageOutput', () => {
		it('writes the image to the location chosen in the save dialog', async () => {
			const saveUri = URI.file('/home/user/project/my-plot.png');
			const showSaveDialog = vi.fn().mockResolvedValue(saveUri);
			const writeFile = vi.fn().mockResolvedValue(undefined);
			const info = vi.fn();
			const fileDialogService = stubInterface<IFileDialogService>({ showSaveDialog });
			const fileService = stubInterface<IFileService>({ writeFile });
			const notificationService = stubInterface<INotificationService>({ info });

			const saved = await saveImageOutput(pngDataUrl, notebookUri, 0, fileDialogService, fileService, logService, notificationService);

			expect(saved).toBe(true);
			expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
				defaultUri: expect.objectContaining({ path: '/home/user/project/notebook_cell1.png' }),
			}));
			expect(writeFile).toHaveBeenCalledWith(saveUri, expect.any(VSBuffer));
			expect(writeFile.mock.calls[0][1].toString()).toBe('fake-png-bytes');
			expect(info).toHaveBeenCalled();
		});

		it('returns false without writing when the dialog is cancelled', async () => {
			const writeFile = vi.fn();
			const fileDialogService = stubInterface<IFileDialogService>({ showSaveDialog: vi.fn().mockResolvedValue(undefined) });
			const fileService = stubInterface<IFileService>({ writeFile });
			const notificationService = stubInterface<INotificationService>({});

			const saved = await saveImageOutput(pngDataUrl, notebookUri, 0, fileDialogService, fileService, logService, notificationService);

			expect(saved).toBe(false);
			expect(writeFile).not.toHaveBeenCalled();
		});

		it('bypasses the dialog when a target URI is provided', async () => {
			const targetUri = URI.file('/tmp/out.png');
			const showSaveDialog = vi.fn();
			const writeFile = vi.fn().mockResolvedValue(undefined);
			const fileDialogService = stubInterface<IFileDialogService>({ showSaveDialog });
			const fileService = stubInterface<IFileService>({ writeFile });
			const notificationService = stubInterface<INotificationService>({ info: vi.fn() });

			const saved = await saveImageOutput(pngDataUrl, notebookUri, 0, fileDialogService, fileService, logService, notificationService, targetUri);

			expect(saved).toBe(true);
			expect(showSaveDialog).not.toHaveBeenCalled();
			expect(writeFile).toHaveBeenCalledWith(targetUri, expect.any(VSBuffer));
		});

		it('notifies an error for a malformed data URL', async () => {
			const error = vi.fn();
			const fileDialogService = stubInterface<IFileDialogService>({});
			const fileService = stubInterface<IFileService>({});
			const notificationService = stubInterface<INotificationService>({ error });

			const saved = await saveImageOutput('not-a-data-url', notebookUri, 0, fileDialogService, fileService, logService, notificationService);

			expect(saved).toBe(false);
			expect(error).toHaveBeenCalled();
		});

		it('notifies an error when writing the file fails', async () => {
			const error = vi.fn();
			const fileDialogService = stubInterface<IFileDialogService>({ showSaveDialog: vi.fn().mockResolvedValue(URI.file('/tmp/out.png')) });
			const fileService = stubInterface<IFileService>({ writeFile: vi.fn().mockRejectedValue(new Error('disk full')) });
			const notificationService = stubInterface<INotificationService>({ error });

			const saved = await saveImageOutput(pngDataUrl, notebookUri, 0, fileDialogService, fileService, logService, notificationService);

			expect(saved).toBe(false);
			expect(error).toHaveBeenCalled();
		});
	});

	describe('openImageOutputInNewTab', () => {
		it('opens the image data in a plot editor tab named after the cell', async () => {
			const openImageInEditor = vi.fn().mockResolvedValue(undefined);
			const plotsService = stubInterface<IPositronPlotsService>({ openImageInEditor });
			const notificationService = stubInterface<INotificationService>({});

			await openImageOutputInNewTab(pngDataUrl, notebookUri, 0, plotsService, logService, notificationService);

			expect(openImageInEditor).toHaveBeenCalledWith(pngDataUrl, 'notebook_cell1');
		});

		it('notifies an error when the image cannot be opened', async () => {
			const error = vi.fn();
			const plotsService = stubInterface<IPositronPlotsService>({
				openImageInEditor: vi.fn().mockRejectedValue(new Error('malformed image data URL')),
			});
			const notificationService = stubInterface<INotificationService>({ error });

			await openImageOutputInNewTab('not-a-data-url', notebookUri, 0, plotsService, logService, notificationService);

			expect(error).toHaveBeenCalled();
		});
	});
});
