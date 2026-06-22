/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { dirname, joinPath, basename } from '../../../../base/common/resources.js';
import { IFileService, FileOperationError, FileOperationResult } from '../../../../platform/files/common/files.js';
import { QUARTO_INLINE_OUTPUT_ENABLED } from '../common/positronQuartoConfig.js';
import { encodeBase64 } from '../../../../base/common/buffer.js';
import { IInlinePreviewItem, QuartoInlinePreviewContribution, QuartoInlinePreviewViewZone } from './quartoInlinePreview.js';
import * as nls from '../../../../nls.js';

/**
 * Regular expression to match markdown image syntax: ![alt text](image path)
 * Captures: [1] = alt text, [2] = image path
 */
const MARKDOWN_IMAGE_REGEX = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;

/**
 * Minimum height for an image preview view zone in pixels.
 */
const MIN_VIEW_ZONE_HEIGHT = 24;

/**
 * Height for error view zones in pixels.
 * Includes padding (8px top + 8px bottom) and margin (8px top + 8px bottom).
 */
const ERROR_VIEW_ZONE_HEIGHT = 56;

/**
 * Maximum height for an image preview in pixels.
 */
const MAX_IMAGE_HEIGHT = 400;

/**
 * Result of resolving an image path.
 */
interface ImageResolveResult {
	/** True if the image was resolved successfully */
	success: boolean;
	/** The data URL for the image (if success is true) */
	dataUrl?: string;
	/** Error message (if success is false and not skipped) */
	errorMessage?: string;
	/** True if the image should be skipped entirely (e.g., remote URLs) */
	skip?: boolean;
}

/**
 * A markdown image found in the document.
 */
interface MarkdownImageItem extends IInlinePreviewItem {
	/** Alt text for the image */
	readonly altText: string;
	/** Path to the image (relative or absolute) */
	readonly imagePath: string;
}

/**
 * View zone for displaying a markdown image preview inline in the editor.
 * Displays just the image without any borders or decorations, or an error
 * message if the image could not be loaded.
 */
class QuartoImagePreviewViewZone extends QuartoInlinePreviewViewZone {
	private readonly _img: HTMLImageElement | undefined;
	private readonly _isError: boolean;

	constructor(
		editor: ICodeEditor,
		lineNumber: number,
		contentKey: string,
		imageSrc: string | undefined,
		altText: string,
		errorMessage?: string,
	) {
		const isError = !imageSrc && !!errorMessage;
		super(
			editor,
			lineNumber,
			contentKey,
			'quarto-image-preview-wrapper',
			'quarto-image-preview-container',
			isError ? ERROR_VIEW_ZONE_HEIGHT : MIN_VIEW_ZONE_HEIGHT,
		);

		this._isError = isError;

		if (isError && errorMessage) {
			const errorContainer = document.createElement('div');
			errorContainer.className = 'quarto-image-preview-error';

			const errorText = document.createElement('span');
			errorText.className = 'quarto-image-preview-error-text';
			errorText.textContent = errorMessage;
			errorContainer.appendChild(errorText);

			this.container.appendChild(errorContainer);
		} else if (imageSrc) {
			this._img = document.createElement('img');
			this._img.className = 'quarto-image-preview';
			this._img.alt = altText;
			this._img.src = imageSrc;

			// Recompute height once the image's natural dimensions are known.
			this._img.addEventListener('load', () => this.updateHeight());

			this.container.appendChild(this._img);
		}
	}

	protected override measureHeight(): number {
		if (this._isError || !this._img) {
			return this.heightInPx;
		}
		const imgHeight = Math.min(this._img.naturalHeight || this._img.offsetHeight, MAX_IMAGE_HEIGHT);
		return Math.max(MIN_VIEW_ZONE_HEIGHT, imgHeight + 8); // 8px for padding
	}
}

/**
 * Editor contribution that manages markdown image preview view zones for Quarto
 * documents.
 */
export class QuartoImagePreviewContribution extends QuartoInlinePreviewContribution<MarkdownImageItem> {
	static readonly ID = 'editor.contrib.quartoImagePreview';

	constructor(
		editor: ICodeEditor,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
	) {
		super(editor);

		this._register(this._contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(new Set([QUARTO_INLINE_OUTPUT_ENABLED.key]))) {
				this.onEnablementChanged();
			}
		}));

		this.start();
	}

	protected override isEnabled(): boolean {
		return this._contextKeyService.getContextKeyValue<boolean>(QUARTO_INLINE_OUTPUT_ENABLED.key) ?? false;
	}

	protected override findItems(model: ITextModel): MarkdownImageItem[] {
		const items: MarkdownImageItem[] = [];
		const lineCount = model.getLineCount();

		for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
			const match = model.getLineContent(lineNumber).match(MARKDOWN_IMAGE_REGEX);
			if (match) {
				items.push({
					lineNumber,
					contentKey: match[2],
					altText: match[1],
					imagePath: match[2],
				});
			}
		}

		return items;
	}

	protected override async createViewZone(item: MarkdownImageItem): Promise<QuartoInlinePreviewViewZone | undefined> {
		const result = await this._resolveImagePath(item.imagePath);

		// Skip remote URLs - don't show preview or error.
		if (result.skip) {
			return undefined;
		}

		if (result.success && result.dataUrl) {
			return new QuartoImagePreviewViewZone(
				this.editor,
				item.lineNumber,
				item.contentKey,
				result.dataUrl,
				item.altText,
			);
		}

		this._logService.info('[QuartoImagePreview] Could not resolve image path:', item.imagePath, '-', result.errorMessage);
		return new QuartoImagePreviewViewZone(
			this.editor,
			item.lineNumber,
			item.contentKey,
			undefined,
			item.altText,
			result.errorMessage,
		);
	}

	/**
	 * Resolve an image path to a data URL that can be used as an img src.
	 * We read the file and convert to data URL to avoid Electron security restrictions
	 * on file:// URLs.
	 * Returns an ImageResolveResult with either the data URL or an error message.
	 */
	private async _resolveImagePath(imagePath: string): Promise<ImageResolveResult> {
		if (!this.documentUri) {
			return {
				success: false,
				errorMessage: nls.localize('quarto.imagePreview.noDocument', 'No document URI')
			};
		}

		// Skip remote URLs - we can only preview local files
		if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
			return { success: false, skip: true };
		}

		// Data URLs are already resolved
		if (imagePath.startsWith('data:')) {
			return { success: true, dataUrl: imagePath };
		}

		// Resolve relative to document directory
		const documentDir = dirname(this.documentUri);
		const imageUri = joinPath(documentDir, imagePath);
		const fileName = basename(imageUri);

		try {
			// Read the file content
			const content = await this._fileService.readFile(imageUri);
			if (content) {
				// Determine MIME type from extension
				const ext = imagePath.toLowerCase().split('.').pop() || '';
				const mimeTypes: Record<string, string> = {
					'jpg': 'image/jpeg',
					'jpeg': 'image/jpeg',
					'png': 'image/png',
					'gif': 'image/gif',
					'svg': 'image/svg+xml',
					'webp': 'image/webp',
					'bmp': 'image/bmp',
					'ico': 'image/x-icon',
				};
				const mimeType = mimeTypes[ext] || 'image/png';

				// Convert to base64 data URL
				const base64 = encodeBase64(content.value);
				const dataUrl = `data:${mimeType};base64,${base64}`;

				return { success: true, dataUrl };
			}
			// If content is null/undefined, return error
			return {
				success: false,
				errorMessage: nls.localize('quarto.imagePreview.emptyFile', '{0}: File is empty', fileName)
			};
		} catch (error) {
			// File doesn't exist or couldn't be read - provide specific error message
			let errorMessage: string;
			if (error instanceof FileOperationError) {
				switch (error.fileOperationResult) {
					case FileOperationResult.FILE_NOT_FOUND:
						errorMessage = nls.localize('quarto.imagePreview.notFound', '{0}: File not found', fileName);
						break;
					case FileOperationResult.FILE_PERMISSION_DENIED:
						errorMessage = nls.localize('quarto.imagePreview.permissionDenied', '{0}: Permission denied', fileName);
						break;
					case FileOperationResult.FILE_IS_DIRECTORY:
						errorMessage = nls.localize('quarto.imagePreview.isDirectory', '{0}: Path is a directory', fileName);
						break;
					case FileOperationResult.FILE_TOO_LARGE:
						errorMessage = nls.localize('quarto.imagePreview.tooLarge', '{0}: File is too large', fileName);
						break;
					default:
						errorMessage = nls.localize('quarto.imagePreview.readError', '{0}: Could not read file', fileName);
				}
			} else {
				// Generic error
				errorMessage = nls.localize('quarto.imagePreview.genericError', '{0}: Could not load image', fileName);
			}

			return { success: false, errorMessage };
		}
	}
}
