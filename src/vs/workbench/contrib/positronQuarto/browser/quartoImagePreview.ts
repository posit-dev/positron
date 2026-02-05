/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IViewZone } from '../../../../editor/browser/editorBrowser.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { dirname, joinPath, basename } from '../../../../base/common/resources.js';
import { IFileService, FileOperationError, FileOperationResult } from '../../../../platform/files/common/files.js';
import { QUARTO_INLINE_OUTPUT_ENABLED, isQuartoDocument } from '../common/positronQuartoConfig.js';
import { EditorLayoutInfo } from '../../../../editor/common/config/editorOptions.js';
import { encodeBase64 } from '../../../../base/common/buffer.js';
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
 * Represents a markdown image found in the document.
 */
interface MarkdownImage {
	/** Line number where the image is declared (1-based) */
	lineNumber: number;
	/** Alt text for the image */
	altText: string;
	/** Path to the image (relative or absolute) */
	imagePath: string;
}

/**
 * View zone for displaying a markdown image preview inline in the editor.
 * Displays just the image without any borders or decorations, or an error
 * message if the image could not be loaded.
 */
class QuartoImagePreviewViewZone extends Disposable implements IViewZone {
	// IViewZone properties
	public afterLineNumber: number;
	public heightInPx: number;
	public readonly domNode: HTMLElement;
	public readonly suppressMouseDown = false;

	private _zoneId: string | undefined;
	private readonly _imageContainer: HTMLElement;
	private readonly _img: HTMLImageElement | undefined;
	private readonly _errorContainer: HTMLElement | undefined;
	private _resizeObserver: ResizeObserver | undefined;
	private readonly _isError: boolean;

	constructor(
		private readonly _editor: ICodeEditor,
		public readonly lineNumber: number,
		private readonly _imageSrc: string | undefined,
		private readonly _altText: string,
		private readonly _errorMessage?: string,
	) {
		super();

		this.afterLineNumber = lineNumber;
		this._isError = !_imageSrc && !!_errorMessage;
		this.heightInPx = this._isError ? ERROR_VIEW_ZONE_HEIGHT : MIN_VIEW_ZONE_HEIGHT;

		// Create outer wrapper
		this.domNode = document.createElement('div');
		this.domNode.className = 'quarto-image-preview-wrapper';

		// Create image container
		this._imageContainer = document.createElement('div');
		this._imageContainer.className = 'quarto-image-preview-container';
		this.domNode.appendChild(this._imageContainer);

		if (this._isError && this._errorMessage) {
			// Create error container
			this._errorContainer = document.createElement('div');
			this._errorContainer.className = 'quarto-image-preview-error';

			// Create error text
			const errorText = document.createElement('span');
			errorText.className = 'quarto-image-preview-error-text';
			errorText.textContent = this._errorMessage;
			this._errorContainer.appendChild(errorText);

			this._imageContainer.appendChild(this._errorContainer);
		} else if (this._imageSrc) {
			// Create image element
			this._img = document.createElement('img');
			this._img.className = 'quarto-image-preview';
			this._img.alt = this._altText;
			this._img.src = this._imageSrc;

			// Handle image load to update height
			this._img.addEventListener('load', () => {
				this._updateHeight();
			});

			// Handle image error - don't hide, show placeholder
			this._img.addEventListener('error', (e) => {
				console.error('[QuartoImagePreview] Image failed to load:', this._imageSrc, e);
				// Don't hide - leave the view zone visible for debugging
				// In production we might want to show a placeholder or error message
			});

			this._imageContainer.appendChild(this._img);
		}

		// Listen for layout changes to update width
		this._register(this._editor.onDidLayoutChange(() => {
			if (this._zoneId) {
				this._applyWidth();
			}
		}));
	}

	/**
	 * Calculate the width for the view zone content area.
	 */
	private _getWidth(layoutInfo: EditorLayoutInfo): number {
		return layoutInfo.contentWidth - layoutInfo.verticalScrollbarWidth - 4;
	}

	/**
	 * Apply width to the view zone based on editor layout.
	 */
	private _applyWidth(): void {
		const layoutInfo = this._editor.getLayoutInfo();
		const width = this._getWidth(layoutInfo);
		this._imageContainer.style.maxWidth = `${width}px`;
	}

	/**
	 * Update the line number this zone appears after.
	 */
	updateAfterLineNumber(lineNumber: number): void {
		if (this.afterLineNumber !== lineNumber) {
			this.afterLineNumber = lineNumber;
			if (this._zoneId) {
				this._editor.changeViewZones(accessor => {
					accessor.removeZone(this._zoneId!);
					this._zoneId = accessor.addZone(this);
				});
				this._applyWidth();
			}
		}
	}

	/**
	 * Show the view zone in the editor.
	 */
	show(): void {
		if (this._zoneId) {
			return;
		}

		this._editor.changeViewZones(accessor => {
			this._zoneId = accessor.addZone(this);
		});

		this._applyWidth();
		this._setupResizeObserver();
	}

	/**
	 * Hide the view zone from the editor.
	 */
	hide(): void {
		if (!this._zoneId) {
			return;
		}

		this._editor.changeViewZones(accessor => {
			accessor.removeZone(this._zoneId!);
		});
		this._zoneId = undefined;

		this._disposeResizeObserver();
	}

	/**
	 * Check if the view zone is currently visible.
	 */
	isVisible(): boolean {
		return this._zoneId !== undefined;
	}

	override dispose(): void {
		this.hide();
		this._disposeResizeObserver();
		super.dispose();
	}

	private _setupResizeObserver(): void {
		if (this._resizeObserver) {
			return;
		}

		this._resizeObserver = new ResizeObserver(() => {
			this._updateHeight();
		});

		this._resizeObserver.observe(this._imageContainer);
	}

	private _disposeResizeObserver(): void {
		if (this._resizeObserver) {
			this._resizeObserver.disconnect();
			this._resizeObserver = undefined;
		}
	}

	private _updateHeight(): void {
		// For error states, use fixed height
		if (this._isError || !this._img) {
			return;
		}

		// Get the natural height of the image, capped at max height
		const imgHeight = Math.min(this._img.naturalHeight || this._img.offsetHeight, MAX_IMAGE_HEIGHT);
		const newHeight = Math.max(MIN_VIEW_ZONE_HEIGHT, imgHeight + 8); // 8px for padding

		if (newHeight !== this.heightInPx && this._zoneId) {
			this.heightInPx = newHeight;

			this._editor.changeViewZones(accessor => {
				accessor.removeZone(this._zoneId!);
				this._zoneId = accessor.addZone(this);
			});
			this._applyWidth();
		} else if (!this._zoneId) {
			this.heightInPx = newHeight;
		}
	}
}

/**
 * Editor contribution that manages markdown image preview view zones for Quarto documents.
 */
export class QuartoImagePreviewContribution extends Disposable implements IEditorContribution {
	static readonly ID = 'editor.contrib.quartoImagePreview';

	private readonly _viewZones = new Map<number, QuartoImagePreviewViewZone>();
	private _documentUri: URI | undefined;
	private _featureEnabled: boolean;
	private _parseTimeout: ReturnType<typeof setTimeout> | undefined;

	private readonly _outputHandlingDisposables = this._register(new DisposableStore());

	constructor(
		private readonly _editor: ICodeEditor,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._logService.info('[QuartoImagePreview] Constructor called');

		const model = this._editor.getModel();
		this._documentUri = model?.uri;

		// Check if feature is enabled
		this._featureEnabled = this._contextKeyService.getContextKeyValue<boolean>(QUARTO_INLINE_OUTPUT_ENABLED.key) ?? false;

		this._logService.info('[QuartoImagePreview] Feature enabled:', this._featureEnabled);
		this._logService.info('[QuartoImagePreview] Is Quarto document:', this._isQuartoDocument());

		// Listen for context key changes
		this._register(this._contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(new Set([QUARTO_INLINE_OUTPUT_ENABLED.key]))) {
				this._handleFeatureToggle();
			}
		}));

		// Handle editor model changes
		this._register(this._editor.onDidChangeModel(() => {
			this._disposeAllViewZones();
			this._outputHandlingDisposables.clear();

			const newModel = this._editor.getModel();
			this._documentUri = newModel?.uri;

			if (this._featureEnabled && this._isQuartoDocument()) {
				this._initializeImagePreviews();
			}
		}));

		// Only initialize if feature is enabled and this is a Quarto document
		if (!this._featureEnabled || !this._isQuartoDocument()) {
			return;
		}

		this._initializeImagePreviews();
	}

	private _initializeImagePreviews(): void {
		this._logService.debug('[QuartoImagePreview] Initializing for', this._documentUri?.toString());

		// Parse document for images
		this._parseDocumentForImages();

		// Listen for content changes with debouncing
		this._outputHandlingDisposables.add(this._editor.onDidChangeModelContent(() => {
			if (this._parseTimeout) {
				clearTimeout(this._parseTimeout);
			}
			this._parseTimeout = setTimeout(() => {
				this._parseTimeout = undefined;
				this._parseDocumentForImages();
			}, 200);
		}));
	}

	private _parseDocumentForImages(): void {
		const model = this._editor.getModel();
		if (!model || !this._documentUri) {
			return;
		}

		const images = this._findMarkdownImages(model);
		this._updateViewZones(images);
	}

	/**
	 * Find all markdown images in the document.
	 */
	private _findMarkdownImages(model: ITextModel): MarkdownImage[] {
		const images: MarkdownImage[] = [];
		const lineCount = model.getLineCount();

		for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
			const lineContent = model.getLineContent(lineNumber);
			const match = lineContent.match(MARKDOWN_IMAGE_REGEX);

			if (match) {
				images.push({
					lineNumber,
					altText: match[1],
					imagePath: match[2],
				});
			}
		}

		return images;
	}

	/**
	 * Update view zones based on found images.
	 */
	private async _updateViewZones(images: MarkdownImage[]): Promise<void> {
		if (!this._documentUri) {
			return;
		}

		this._logService.debug('[QuartoImagePreview] Found', images.length, 'images in document');

		// Track which line numbers have images
		const imagesByLine = new Map<number, MarkdownImage>();
		for (const image of images) {
			imagesByLine.set(image.lineNumber, image);
		}

		// Remove view zones for lines that no longer have images
		for (const [lineNumber, viewZone] of this._viewZones) {
			if (!imagesByLine.has(lineNumber)) {
				viewZone.dispose();
				this._viewZones.delete(lineNumber);
			}
		}

		// Add or update view zones for images
		const createPromises: Promise<void>[] = [];
		for (const image of images) {
			const existingZone = this._viewZones.get(image.lineNumber);

			if (existingZone) {
				// Update position if needed
				existingZone.updateAfterLineNumber(image.lineNumber);
			} else {
				// Create new view zone (async)
				createPromises.push(this._createViewZoneForImage(image));
			}
		}

		// Wait for all view zones to be created
		await Promise.all(createPromises);
	}

	/**
	 * Create a view zone for a markdown image.
	 */
	private async _createViewZoneForImage(image: MarkdownImage): Promise<void> {
		if (!this._documentUri) {
			this._logService.debug('[QuartoImagePreview] No document URI');
			return;
		}

		this._logService.debug('[QuartoImagePreview] Creating view zone for image at line', image.lineNumber, ':', image.imagePath);

		// Resolve the image path relative to the document
		const result = await this._resolveImagePath(image.imagePath);

		// Skip remote URLs - don't show preview or error
		if (result.skip) {
			this._logService.debug('[QuartoImagePreview] Skipping remote image:', image.imagePath);
			return;
		}

		let viewZone: QuartoImagePreviewViewZone;
		if (result.success && result.dataUrl) {
			this._logService.debug('[QuartoImagePreview] Resolved image src, length:', result.dataUrl.length);
			viewZone = new QuartoImagePreviewViewZone(
				this._editor,
				image.lineNumber,
				result.dataUrl,
				image.altText,
			);
		} else {
			// Create an error view zone
			this._logService.info('[QuartoImagePreview] Could not resolve image path:', image.imagePath, '-', result.errorMessage);
			viewZone = new QuartoImagePreviewViewZone(
				this._editor,
				image.lineNumber,
				undefined,
				image.altText,
				result.errorMessage,
			);
		}

		this._viewZones.set(image.lineNumber, viewZone);
		viewZone.show();
		this._logService.debug('[QuartoImagePreview] View zone created and shown');
	}

	/**
	 * Resolve an image path to a data URL that can be used as an img src.
	 * We read the file and convert to data URL to avoid Electron security restrictions
	 * on file:// URLs.
	 * Returns an ImageResolveResult with either the data URL or an error message.
	 */
	private async _resolveImagePath(imagePath: string): Promise<ImageResolveResult> {
		if (!this._documentUri) {
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
		const documentDir = dirname(this._documentUri);
		const imageUri = joinPath(documentDir, imagePath);
		const fileName = basename(imageUri);

		this._logService.debug('[QuartoImagePreview] Resolving image path:', imagePath);
		this._logService.debug('[QuartoImagePreview] Document dir:', documentDir.toString());
		this._logService.debug('[QuartoImagePreview] Image URI:', imageUri.toString());

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

				this._logService.debug('[QuartoImagePreview] Converted to data URL, length:', dataUrl.length);
				return { success: true, dataUrl };
			}
			// If content is null/undefined, return error
			return {
				success: false,
				errorMessage: nls.localize('quarto.imagePreview.emptyFile', '{0}: File is empty', fileName)
			};
		} catch (error) {
			// File doesn't exist or couldn't be read - provide specific error message
			this._logService.debug('[QuartoImagePreview] File read failed:', error);

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

	private _isQuartoDocument(): boolean {
		const model = this._editor.getModel();
		return isQuartoDocument(this._documentUri?.path, model?.getLanguageId());
	}

	private _handleFeatureToggle(): void {
		const enabled = this._contextKeyService.getContextKeyValue<boolean>(QUARTO_INLINE_OUTPUT_ENABLED.key) ?? false;
		this._featureEnabled = enabled;

		if (!enabled) {
			this._disposeAllViewZones();
			this._outputHandlingDisposables.clear();
			if (this._parseTimeout) {
				clearTimeout(this._parseTimeout);
				this._parseTimeout = undefined;
			}
		} else if (this._isQuartoDocument()) {
			this._initializeImagePreviews();
		}
	}

	private _disposeAllViewZones(): void {
		for (const viewZone of this._viewZones.values()) {
			viewZone.dispose();
		}
		this._viewZones.clear();
	}

	override dispose(): void {
		if (this._parseTimeout) {
			clearTimeout(this._parseTimeout);
		}
		this._disposeAllViewZones();
		super.dispose();
	}
}
