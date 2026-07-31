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
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { decodeImageDataUrl, getDefaultImageFilename, openImageOutputInNewTab, saveImageOutput } from '../../browser/imageOutputUtils.js';

const notebookUri = URI.file('/home/user/project/notebook.ipynb');
const pngDataUrl = `data:image/png;base64,${encodeBase64(VSBuffer.fromString('fake-png-bytes'))}`;

describe('imageOutputUtils', () => {
	createTestContainer().build();

	const logService = new NullLogService();

	describe('decodeImageDataUrl', () => {
		it('decodes a base64 PNG data URL', () => {
			const decoded = decodeImageDataUrl(pngDataUrl);
			expect(decoded?.mimeType).toBe('image/png');
			expect(decoded?.data.toString()).toBe('fake-png-bytes');
		});

		it('decodes a URL-encoded SVG data URL', () => {
			const svg = '<svg><circle r="10"/></svg>';
			const decoded = decodeImageDataUrl(`data:image/svg+xml,${encodeURIComponent(svg)}`);
			expect(decoded?.mimeType).toBe('image/svg+xml');
			expect(decoded?.data.toString()).toBe(svg);
		});

		it('keeps raw SVG payload with literal percent signs', () => {
			const decoded = decodeImageDataUrl('data:image/svg+xml,<text>100% done</text>');
			expect(decoded?.data.toString()).toBe('<text>100% done</text>');
		});

		it('returns undefined for a malformed data URL', () => {
			expect(decodeImageDataUrl('not-a-data-url')).toBeUndefined();
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
		it('writes a hidden temp file next to the notebook and opens it', async () => {
			const writeFile = vi.fn().mockResolvedValue(undefined);
			const openEditor = vi.fn().mockResolvedValue(undefined);
			const fileService = stubInterface<IFileService>({ writeFile });
			const editorService = stubInterface<IEditorService>({ openEditor });
			const notificationService = stubInterface<INotificationService>({});

			await openImageOutputInNewTab(pngDataUrl, notebookUri, 0, editorService, fileService, logService, notificationService);

			const tempUri = writeFile.mock.calls[0][0] as URI;
			expect(tempUri.path).toBe('/home/user/project/.positron-temp-notebook_cell1.png');
			expect(writeFile.mock.calls[0][1].toString()).toBe('fake-png-bytes');
			expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({ resource: tempUri }));
		});

		it('notifies an error for a malformed data URL', async () => {
			const error = vi.fn();
			const openEditor = vi.fn();
			const fileService = stubInterface<IFileService>({});
			const editorService = stubInterface<IEditorService>({ openEditor });
			const notificationService = stubInterface<INotificationService>({ error });

			await openImageOutputInNewTab('not-a-data-url', notebookUri, 0, editorService, fileService, logService, notificationService);

			expect(error).toHaveBeenCalled();
			expect(openEditor).not.toHaveBeenCalled();
		});

		it('notifies an error when opening fails', async () => {
			const error = vi.fn();
			const fileService = stubInterface<IFileService>({ writeFile: vi.fn().mockRejectedValue(new Error('read-only')) });
			const editorService = stubInterface<IEditorService>({});
			const notificationService = stubInterface<INotificationService>({ error });

			await openImageOutputInNewTab(pngDataUrl, notebookUri, 0, editorService, fileService, logService, notificationService);

			expect(error).toHaveBeenCalled();
		});
	});
});
