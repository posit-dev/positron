/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer, encodeBase64 } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import {
	defaultImageFileName,
	imageBytesFromDataUrl,
	imageExtensionFromDataUrl,
	openImageInEditorFromDataUrl,
	saveImageFromDataUrl,
} from '../../browser/notebookImageOutputUtils.js';

describe('notebookImageOutputUtils', () => {
	createTestContainer().build();

	describe('imageExtensionFromDataUrl', () => {
		it('returns .png for png data URLs', () => {
			expect(imageExtensionFromDataUrl('data:image/png;base64,abc')).toBe('.png');
		});

		it('returns .svg for svg data URLs', () => {
			expect(imageExtensionFromDataUrl('data:image/svg+xml,%3Csvg%3E')).toBe('.svg');
		});

		it('returns .jpg for jpeg data URLs', () => {
			expect(imageExtensionFromDataUrl('data:image/jpeg;base64,abc')).toBe('.jpg');
		});

		it('returns .gif for gif data URLs', () => {
			expect(imageExtensionFromDataUrl('data:image/gif;base64,abc')).toBe('.gif');
		});

		it('returns .webp for webp data URLs', () => {
			expect(imageExtensionFromDataUrl('data:image/webp;base64,abc')).toBe('.webp');
		});

		it('defaults to .png for unknown MIME types', () => {
			expect(imageExtensionFromDataUrl('data:application/octet-stream;base64,abc')).toBe('.png');
			expect(imageExtensionFromDataUrl('not-a-data-url')).toBe('.png');
		});
	});

	describe('imageBytesFromDataUrl', () => {
		it('decodes a base64 PNG data URL', () => {
			const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
			const dataUrl = `data:image/png;base64,${encodeBase64(VSBuffer.wrap(bytes))}`;
			const result = imageBytesFromDataUrl(dataUrl);
			expect(result).toBeDefined();
			expect(Array.from(result!)).toEqual(Array.from(bytes));
		});

		it('decodes a URL-encoded SVG data URL', () => {
			const svg = '<svg><circle r="10"/></svg>';
			const dataUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;
			const result = imageBytesFromDataUrl(dataUrl);
			expect(result).toBeDefined();
			expect(VSBuffer.wrap(result!).toString()).toBe(svg);
		});

		it('returns undefined for a malformed data URL', () => {
			expect(imageBytesFromDataUrl('data:image/png')).toBeUndefined();
		});
	});

	describe('defaultImageFileName', () => {
		it('builds <docNameNoExt>_cell<index><ext>', () => {
			const uri = URI.file('/home/user/analysis.ipynb');
			expect(defaultImageFileName(uri, 2, '.png')).toBe('analysis_cell2.png');
		});

		it('handles documents without an extension', () => {
			const uri = URI.file('/home/user/notebook');
			expect(defaultImageFileName(uri, 0, '.svg')).toBe('notebook_cell0.svg');
		});
	});

	const notebookUri = URI.file('/home/user/analysis.ipynb');
	const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
	const pngDataUrl = `data:image/png;base64,${encodeBase64(VSBuffer.wrap(pngBytes))}`;

	function makeServiceMocks() {
		const writeFile = vi.fn().mockResolvedValue(undefined);
		const showSaveDialog = vi.fn();
		const openEditor = vi.fn().mockResolvedValue(undefined);
		const info = vi.fn();
		const error = vi.fn();
		const logError = vi.fn();
		return {
			writeFile,
			showSaveDialog,
			openEditor,
			info,
			error,
			logError,
			fileService: { writeFile } as unknown as IFileService,
			fileDialogService: { showSaveDialog } as unknown as IFileDialogService,
			editorService: { openEditor } as unknown as IEditorService,
			notificationService: { info, error } as unknown as INotificationService,
			logService: { error: logError } as unknown as ILogService,
		};
	}

	describe('saveImageFromDataUrl', () => {
		it('writes the decoded bytes and notifies on success (targetPath bypasses dialog)', async () => {
			const m = makeServiceMocks();
			const targetPath = URI.file('/home/user/out.png');

			const result = await saveImageFromDataUrl(
				{ dataUrl: pngDataUrl, notebookUri, cellIndex: 1 },
				m.fileDialogService,
				m.fileService,
				m.logService,
				m.notificationService,
				targetPath,
			);

			expect(result).toBe(true);
			expect(m.showSaveDialog).not.toHaveBeenCalled();
			expect(m.writeFile).toHaveBeenCalledTimes(1);
			const [writtenUri, writtenBuffer] = m.writeFile.mock.calls[0];
			expect(writtenUri.toString()).toBe(targetPath.toString());
			expect(Array.from((writtenBuffer as VSBuffer).buffer)).toEqual(Array.from(pngBytes));
			expect(m.info).toHaveBeenCalledTimes(1);
			expect(m.error).not.toHaveBeenCalled();
		});

		it('writes to the save-dialog result when no targetPath is given', async () => {
			const m = makeServiceMocks();
			const chosen = URI.file('/home/user/chosen.png');
			m.showSaveDialog.mockResolvedValue(chosen);

			const result = await saveImageFromDataUrl(
				{ dataUrl: pngDataUrl, notebookUri, cellIndex: 0 },
				m.fileDialogService,
				m.fileService,
				m.logService,
				m.notificationService,
			);

			expect(result).toBe(true);
			expect(m.showSaveDialog).toHaveBeenCalledTimes(1);
			expect(m.writeFile.mock.calls[0][0].toString()).toBe(chosen.toString());
		});

		it('returns false without writing when the dialog is cancelled', async () => {
			const m = makeServiceMocks();
			m.showSaveDialog.mockResolvedValue(undefined);

			const result = await saveImageFromDataUrl(
				{ dataUrl: pngDataUrl, notebookUri, cellIndex: 0 },
				m.fileDialogService,
				m.fileService,
				m.logService,
				m.notificationService,
			);

			expect(result).toBe(false);
			expect(m.writeFile).not.toHaveBeenCalled();
			expect(m.info).not.toHaveBeenCalled();
			expect(m.error).not.toHaveBeenCalled();
		});

		it('reports an error and returns false for an undecodable data URL', async () => {
			const m = makeServiceMocks();
			const targetPath = URI.file('/home/user/out.png');

			const result = await saveImageFromDataUrl(
				{ dataUrl: 'data:image/png', notebookUri, cellIndex: 0 },
				m.fileDialogService,
				m.fileService,
				m.logService,
				m.notificationService,
				targetPath,
			);

			expect(result).toBe(false);
			expect(m.writeFile).not.toHaveBeenCalled();
			expect(m.error).toHaveBeenCalledTimes(1);
			expect(m.logError).toHaveBeenCalledTimes(1);
		});
	});

	describe('openImageInEditorFromDataUrl', () => {
		it('writes a temp .positron-temp-* file and opens it in an editor', async () => {
			const m = makeServiceMocks();

			await openImageInEditorFromDataUrl(
				{ dataUrl: pngDataUrl, notebookUri, cellIndex: 3 },
				m.fileService,
				m.editorService,
			);

			expect(m.writeFile).toHaveBeenCalledTimes(1);
			const [tempUri, tempBuffer] = m.writeFile.mock.calls[0];
			expect(tempUri.path).toBe('/home/user/.positron-temp-analysis_cell3.png');
			expect(Array.from((tempBuffer as VSBuffer).buffer)).toEqual(Array.from(pngBytes));

			expect(m.openEditor).toHaveBeenCalledTimes(1);
			expect(m.openEditor.mock.calls[0][0].resource.toString()).toBe(tempUri.toString());
		});

		it('throws for an undecodable data URL without opening an editor', async () => {
			const m = makeServiceMocks();

			await expect(openImageInEditorFromDataUrl(
				{ dataUrl: 'data:image/png', notebookUri, cellIndex: 0 },
				m.fileService,
				m.editorService,
			)).rejects.toThrow();
			expect(m.writeFile).not.toHaveBeenCalled();
			expect(m.openEditor).not.toHaveBeenCalled();
		});
	});
});
