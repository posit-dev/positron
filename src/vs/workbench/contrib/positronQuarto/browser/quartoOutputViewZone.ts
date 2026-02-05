/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { safeSetInnerHtml } from '../../../../base/browser/domSanitize.js';
import { status as ariaStatus } from '../../../../base/browser/ui/aria/aria.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IViewZone } from '../../../../editor/browser/editorBrowser.js';
import { localize } from '../../../../nls.js';
import { ICellOutput, ICellOutputItem } from '../common/quartoExecutionTypes.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Event as VSEvent, Emitter } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { INotebookOutputWebview, IPositronNotebookOutputWebviewService } from '../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { isHTMLOutputWebviewMessage } from '../../positronWebviewPreloads/browser/notebookOutputUtils.js';
import { ILanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { RuntimeOutputKind, ILanguageRuntimeMessageWebOutput, PositronOutputLocation, LanguageRuntimeMessageType } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { EditorLayoutInfo, EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { applyFontInfo } from '../../../../editor/browser/config/domFontInfo.js';
import { ANSIOutput, ANSIOutputLine, ANSIOutputRun, ANSIColor, ANSIStyle } from '../../../../base/common/ansiOutput.js';

/**
 * Minimum height for a view zone in pixels.
 */
const MIN_VIEW_ZONE_HEIGHT = 24;

/**
 * Type of content to copy from output.
 */
export type CopyOutputContent =
	| { type: 'text'; text: string }
	| { type: 'image'; dataUrl: string };

/**
 * Request to save a plot output.
 */
export interface SavePlotRequest {
	/** The cell ID */
	readonly cellId: string;
	/** The image data URL */
	readonly dataUrl: string;
	/** The MIME type of the image */
	readonly mimeType: string;
}

/**
 * Type of popout action to perform.
 */
export type PopoutType =
	| { type: 'plot'; dataUrl: string; mimeType: string }
	| { type: 'text'; text: string }
	| { type: 'html'; html: string; webviewMetadata?: ICellOutput['webviewMetadata'] }
	| { type: 'webview'; rawData: Record<string, unknown>; outputId: string };

/**
 * Request to pop out output content.
 */
export interface PopoutRequest {
	/** The cell ID */
	readonly cellId: string;
	/** The popout type and content */
	readonly popout: PopoutType;
}

/**
 * Request to copy output content.
 */
export interface CopyOutputRequest {
	/** The cell ID */
	readonly cellId: string;
	/** The content to copy */
	readonly content: CopyOutputContent;
}

/**
 * Options for creating a QuartoOutputViewZone.
 */
export interface QuartoOutputViewZoneOptions {
	/** The editor to create the view zone in */
	readonly editor: ICodeEditor;
	/** The cell ID this view zone belongs to */
	readonly cellId: string;
	/** The line number to position the view zone after */
	readonly afterLine: number;
	/** Optional webview service for rendering complex outputs */
	readonly webviewService?: IPositronNotebookOutputWebviewService;
	/** Optional runtime session for webview creation */
	readonly session?: ILanguageRuntimeSession;
	/** Maximum number of lines to display in text output before truncating */
	readonly maxLines?: number;
}

/**
 * View zone for displaying Quarto cell output inline in the editor.
 * Supports text, images, error output, and complex webview-based outputs.
 */
export class QuartoOutputViewZone extends Disposable implements IViewZone {
	// IViewZone properties
	public afterLineNumber: number;
	public heightInPx: number;
	public readonly domNode: HTMLElement;
	// Keep as false so Monaco does NOT call preventDefault() on mousedown,
	// which would prevent browser text selection from working.
	public readonly suppressMouseDown = false;

	/**
	 * Callback that Monaco calls when the view zone's top position changes during scrolling.
	 * We use this to immediately update webview positions for smooth scrolling.
	 */
	public readonly onDomNodeTop = (_top: number): void => {
		this._layoutAllWebviews();
	};

	private _zoneId: string | undefined;
	private _outputs: ICellOutput[] = [];
	private readonly _outputContainer: HTMLElement;
	private readonly _closeButton: HTMLButtonElement;
	private _resizeObserver: ResizeObserver | undefined;

	// Webview support
	private readonly _webviewService: IPositronNotebookOutputWebviewService | undefined;
	private _session: ILanguageRuntimeSession | undefined;
	private readonly _webviewDisposables = this._register(new DisposableStore());
	private readonly _webviewsByOutputId = new Map<string, INotebookOutputWebview>();
	// Map from output ID to the container element for re-layout during scrolling
	private readonly _webviewContainersByOutputId = new Map<string, HTMLElement>();
	// Cached clipping container for the editor
	private _clippingContainer: HTMLElement | undefined;

	// Callback when outputs are cleared by user action
	private _onClear: (() => void) | undefined;

	// Callback when execution should be interrupted
	private _onInterrupt: (() => void) | undefined;

	// Whether the cell is currently executing
	private _isExecuting = false;

	// Whether the cell is in "recomputing" state (waiting for new output to replace old)
	private _isRecomputing = false;

	// Maximum number of lines to display for text output before truncating
	private _maxLines: number;

	// Inner styled container (separate from domNode so Monaco's height doesn't stretch it)
	private readonly _styledContainer: HTMLElement;

	// Icon element inside the close button (for switching between close and stop icons)
	private _buttonIcon!: HTMLSpanElement;

	// Copy button
	private readonly _copyButton: HTMLButtonElement;
	// Icon element inside the copy button (for switching between copy and check icons)
	private _copyButtonIcon!: HTMLSpanElement;
	// Timeout for reverting copy button back to copy icon
	private _copyButtonTimeout: ReturnType<typeof setTimeout> | undefined;

	// Event emitted when copy is requested (signals to outer code to perform clipboard operation)
	private readonly _onCopyRequested = this._register(new Emitter<CopyOutputRequest>());
	readonly onCopyRequested: VSEvent<CopyOutputRequest> = this._onCopyRequested.event;

	// Save button
	private readonly _saveButton: HTMLButtonElement;
	// Icon element inside the save button
	private _saveButtonIcon!: HTMLSpanElement;
	// Event emitted when save is requested (signals to outer code to perform save operation)
	private readonly _onSaveRequested = this._register(new Emitter<SavePlotRequest>());
	readonly onSaveRequested: VSEvent<SavePlotRequest> = this._onSaveRequested.event;

	// Popout button
	private readonly _popoutButton: HTMLButtonElement;
	// Icon element inside the popout button
	private _popoutButtonIcon!: HTMLSpanElement;
	// Event emitted when popout is requested (signals to outer code to open output in new tab/viewer)
	private readonly _onPopoutRequested = this._register(new Emitter<PopoutRequest>());
	readonly onPopoutRequested: VSEvent<PopoutRequest> = this._onPopoutRequested.event;

	constructor(
		private readonly _editor: ICodeEditor,
		public readonly cellId: string,
		afterLine: number,
		webviewService?: IPositronNotebookOutputWebviewService,
		session?: ILanguageRuntimeSession,
		maxLines: number = 40,
	) {
		super();

		this._webviewService = webviewService;
		this._session = session;
		this._maxLines = maxLines;

		this.afterLineNumber = afterLine;
		this.heightInPx = MIN_VIEW_ZONE_HEIGHT;

		// Create outer wrapper (Monaco controls this element's height)
		this.domNode = document.createElement('div');
		this.domNode.className = 'quarto-inline-output-wrapper';

		// Create inner styled container (sizes to content, not stretched by Monaco)
		this._styledContainer = document.createElement('div');
		this._styledContainer.className = 'quarto-inline-output';
		this._styledContainer.setAttribute('role', 'region');
		this._styledContainer.setAttribute('aria-label', localize('quartoOutput', 'Cell output'));
		this._styledContainer.setAttribute('tabindex', '0');
		this.domNode.appendChild(this._styledContainer);

		// Create button container for close and copy buttons
		const buttonContainer = document.createElement('div');
		buttonContainer.className = 'quarto-output-button-container';

		// Create close button
		this._closeButton = this._createCloseButton();
		buttonContainer.appendChild(this._closeButton);

		// Create copy button; initially hidden (shown first after close since it's most common)
		this._copyButton = this._createCopyButton();
		buttonContainer.appendChild(this._copyButton);
		this._copyButton.style.display = 'none';

		// Create popout button; initially hidden
		this._popoutButton = this._createPopoutButton();
		buttonContainer.appendChild(this._popoutButton);
		this._popoutButton.style.display = 'none';

		// Create save button; initially hidden
		this._saveButton = this._createSaveButton();
		buttonContainer.appendChild(this._saveButton);
		this._saveButton.style.display = 'none';

		this._styledContainer.appendChild(buttonContainer);

		// Create output container
		this._outputContainer = document.createElement('div');
		this._outputContainer.className = 'quarto-output-content';
		this._styledContainer.appendChild(this._outputContainer);

		// Apply editor font to the output container
		this._applyEditorFont();

		// Listen for font changes
		this._register(this._editor.onDidChangeConfiguration(e => {
			if (e.hasChanged(EditorOption.fontInfo)) {
				this._applyEditorFont();
			}
		}));

		// Listen for layout changes to update width
		this._register(this._editor.onDidLayoutChange(() => {
			if (this._zoneId) {
				this._applyWidth();
			}
		}));

		// Set up keyboard navigation
		this._setupKeyboardNavigation();

		// Set up mouse event handling for text selection
		this._setupTextSelection();
	}

	/**
	 * Apply the editor's font settings to the output container.
	 */
	private _applyEditorFont(): void {
		const fontInfo = this._editor.getOption(EditorOption.fontInfo);
		applyFontInfo(this._outputContainer, fontInfo);
	}

	/**
	 * Calculate the width for the view zone content area.
	 * Uses the content width minus scrollbar to prevent overlap.
	 */
	private _getWidth(layoutInfo: EditorLayoutInfo): number {
		// contentWidth is the content area width (excludes line numbers and minimap),
		// but includes the scrollbar overlay area. Subtract scrollbar width and a small
		// margin for visual padding.
		return layoutInfo.contentWidth - layoutInfo.verticalScrollbarWidth - 4;
	}

	/**
	 * Apply width to the view zone based on editor layout.
	 * This must be called AFTER the zone is added because Monaco sets width: 100%
	 * when adding zones, which would override any earlier width setting.
	 */
	private _applyWidth(): void {
		const layoutInfo = this._editor.getLayoutInfo();
		const width = this._getWidth(layoutInfo);
		this._styledContainer.style.width = `${width}px`;
	}

	/**
	 * Get the current outputs.
	 */
	get outputs(): readonly ICellOutput[] {
		return this._outputs;
	}

	/**
	 * Set callback for when outputs are cleared.
	 */
	set onClear(callback: (() => void) | undefined) {
		this._onClear = callback;
	}

	/**
	 * Set the maximum number of lines to display in text output.
	 * If output exceeds this limit, only the last N lines are shown with a truncation indicator.
	 */
	set maxLines(value: number) {
		if (this._maxLines !== value) {
			this._maxLines = value;
			// Re-render outputs if they exist
			if (this._outputs.length > 0) {
				this._renderAllOutputs();
				this._updateHeight();
			}
		}
	}

	/**
	 * Get the maximum number of lines to display in text output.
	 */
	get maxLines(): number {
		return this._maxLines;
	}

	/**
	 * Set callback for when execution should be interrupted.
	 */
	set onInterrupt(callback: (() => void) | undefined) {
		this._onInterrupt = callback;
	}

	/**
	 * Set whether the cell is currently executing.
	 * Updates the button to show stop or close icon accordingly.
	 */
	setExecuting(isExecuting: boolean): void {
		if (this._isExecuting === isExecuting) {
			return;
		}
		this._isExecuting = isExecuting;
		this._updateButtonForExecutionState();
	}

	/**
	 * Set whether the cell is in "recomputing" state.
	 * In this state, the old output is shown with reduced opacity and dotted border
	 * while waiting for new output to arrive.
	 */
	setRecomputing(isRecomputing: boolean): void {
		if (this._isRecomputing === isRecomputing) {
			return;
		}
		this._isRecomputing = isRecomputing;
		this._updateRecomputingState();
	}

	/**
	 * Get whether the cell is in recomputing state.
	 */
	get isRecomputing(): boolean {
		return this._isRecomputing;
	}

	/**
	 * Update the visual appearance for recomputing state.
	 */
	private _updateRecomputingState(): void {
		if (this._isRecomputing) {
			this._styledContainer.classList.add('quarto-output-recomputing');
			// Disable copy button during recomputing
			this._copyButton.disabled = true;
		} else {
			this._styledContainer.classList.remove('quarto-output-recomputing');
			// Re-enable copy button
			this._copyButton.disabled = false;
		}
	}

	/**
	 * Update the button appearance based on execution state.
	 */
	private _updateButtonForExecutionState(): void {
		if (this._isExecuting) {
			this._buttonIcon.className = ThemeIcon.asClassName(Codicon.debugStop);
			this._closeButton.setAttribute('aria-label', localize('interruptExecution', 'Interrupt execution'));
			this._closeButton.title = localize('interruptExecution', 'Interrupt execution');
		} else {
			this._buttonIcon.className = ThemeIcon.asClassName(Codicon.close);
			this._closeButton.setAttribute('aria-label', localize('clearOutput', 'Clear output'));
			this._closeButton.title = localize('clearOutput', 'Clear output');
		}
	}

	/**
	 * Update the runtime session for webview creation.
	 * Call this when the kernel session becomes available.
	 *
	 * IMPORTANT: If the session transitions from undefined to defined and we have
	 * outputs that need webview rendering, we must re-render them. This handles
	 * the case where cached outputs are loaded before the kernel session is reattached
	 * after a window reload.
	 */
	setSession(session: ILanguageRuntimeSession | undefined): void {
		const hadNoSession = !this._session;
		this._session = session;

		// Re-render outputs if session just became available
		// This allows cached interactive outputs (Plotly, widgets) to render correctly
		// after the kernel session is reattached
		if (hadNoSession && session && this._outputs.length > 0) {
			// Check if any outputs need webview rendering
			const needsRerender = this._outputs.some(output => output.webviewMetadata?.webviewType);
			if (needsRerender) {
				this._renderAllOutputs();
				this._updateHeight();
			}
		}
	}

	/**
	 * Add an output to the view zone.
	 */
	addOutput(output: ICellOutput): void {
		// If we're in recomputing state and this is the first new output,
		// clear the old outputs and exit recomputing state
		if (this._isRecomputing) {
			// Clear old outputs before adding new one
			this._outputs = [];
			dom.clearNode(this._outputContainer);
			this._disposeAllWebviews();
			this.setRecomputing(false);
		}

		this._outputs.push(output);
		this._renderOutput(output);
		// Update error-only class after adding new output
		this._styledContainer.classList.toggle('quarto-output-error-only', this._isErrorOnly());
		this._updateHeight();
		this._announceOutput(output);
	}

	/**
	 * Set all outputs, replacing existing ones.
	 */
	setOutputs(outputs: ICellOutput[]): void {
		this._outputs = [...outputs];
		this._renderAllOutputs();
		this._updateHeight();
	}

	/**
	 * Clear all outputs and hide the view zone.
	 * Called when the user clicks the close button.
	 */
	clearOutputs(): void {
		this._outputs = [];
		dom.clearNode(this._outputContainer);

		// Dispose all webviews
		this._disposeAllWebviews();

		// Reset recomputing state
		this._isRecomputing = false;
		this._styledContainer.classList.remove('quarto-output-recomputing');

		// Hide the view zone when outputs are cleared
		this.hide();

		this._onClear?.();
	}

	/**
	 * Dispose all webviews managed by this view zone.
	 */
	private _disposeAllWebviews(): void {
		for (const webview of this._webviewsByOutputId.values()) {
			webview.webview.release(this);
			webview.dispose();
		}
		this._webviewsByOutputId.clear();
		this._webviewContainersByOutputId.clear();
		this._webviewDisposables.clear();
	}

	/**
	 * Update the line number this zone appears after.
	 */
	updateAfterLineNumber(lineNumber: number): void {
		if (this.afterLineNumber !== lineNumber) {
			this.afterLineNumber = lineNumber;
			// Re-add the zone to update its position
			if (this._zoneId) {
				this._editor.changeViewZones(accessor => {
					accessor.removeZone(this._zoneId!);
					this._zoneId = accessor.addZone(this);
				});
				// Re-apply width after zone is re-added
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

		// Apply width AFTER zone is added because Monaco sets width: 100%
		// when adding zones, which would override any earlier width setting
		this._applyWidth();

		// Set up resize observer after showing
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

	/**
	 * Get the zone ID if visible.
	 */
	getZoneId(): string | undefined {
		return this._zoneId;
	}

	override dispose(): void {
		this.hide();
		this._disposeResizeObserver();
		this._disposeAllWebviews();
		if (this._copyButtonTimeout) {
			clearTimeout(this._copyButtonTimeout);
		}
		super.dispose();
	}

	private _createCloseButton(): HTMLButtonElement {
		const button = document.createElement('button');
		button.className = 'quarto-output-close';
		button.setAttribute('aria-label', localize('clearOutput', 'Clear output'));
		button.title = localize('clearOutput', 'Clear output');

		// Use codicon for close button - store reference in _buttonIcon for later updates
		this._buttonIcon = document.createElement('span');
		this._buttonIcon.className = ThemeIcon.asClassName(Codicon.close);
		button.appendChild(this._buttonIcon);

		// Handle mousedown to prevent the editor from consuming the event
		button.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
		});

		// Handle click to clear outputs or interrupt execution
		button.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (this._isExecuting) {
				this._onInterrupt?.();
			} else {
				this.clearOutputs();
			}
		});

		return button;
	}

	private _createCopyButton(): HTMLButtonElement {
		const button = document.createElement('button');
		button.className = 'quarto-output-copy';
		button.setAttribute('aria-label', localize('copyOutput', 'Copy output'));
		button.title = localize('copyOutput', 'Copy output');

		// Use codicon for copy button
		this._copyButtonIcon = document.createElement('span');
		this._copyButtonIcon.className = ThemeIcon.asClassName(Codicon.copy);
		button.appendChild(this._copyButtonIcon);

		// Handle mousedown to prevent the editor from consuming the event
		button.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
		});

		// Handle click to trigger copy
		button.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this._handleCopyClick();
		});

		return button;
	}

	private _createSaveButton(): HTMLButtonElement {
		const button = document.createElement('button');
		button.className = 'quarto-output-save';
		button.setAttribute('aria-label', localize('savePlot', 'Save plot'));
		button.title = localize('savePlot', 'Save plot');

		// Use codicon for save button (save icon)
		this._saveButtonIcon = document.createElement('span');
		this._saveButtonIcon.className = ThemeIcon.asClassName(Codicon.save);
		button.appendChild(this._saveButtonIcon);

		// Handle mousedown to prevent the editor from consuming the event
		button.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
		});

		// Handle click to trigger save
		button.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this._handleSaveClick();
		});

		return button;
	}

	private _createPopoutButton(): HTMLButtonElement {
		const button = document.createElement('button');
		button.className = 'quarto-output-popout';
		button.setAttribute('aria-label', localize('popoutOutput', 'Open output in new tab'));
		button.title = localize('popoutOutput', 'Open output in new tab');

		// Use codicon for popout button (link-external icon)
		this._popoutButtonIcon = document.createElement('span');
		this._popoutButtonIcon.className = ThemeIcon.asClassName(Codicon.linkExternal);
		button.appendChild(this._popoutButtonIcon);

		// Handle mousedown to prevent the editor from consuming the event
		button.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
		});

		// Handle click to trigger popout
		button.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this._handlePopoutClick();
		});

		return button;
	}

	/**
	 * Handle click on the copy button.
	 * Determines what content to copy and emits the copy request event.
	 */
	private _handleCopyClick(): void {
		const content = this._getContentToCopy();
		if (content) {
			this._onCopyRequested.fire({
				cellId: this.cellId,
				content,
			});
		}
	}

	/**
	 * Handle click on the save button.
	 * Fires the save request event with the single plot data.
	 */
	private _handleSaveClick(): void {
		const plotInfo = this._getSinglePlotInfo();
		if (plotInfo) {
			this._onSaveRequested.fire({
				cellId: this.cellId,
				dataUrl: plotInfo.dataUrl,
				mimeType: plotInfo.mimeType,
			});
		}
	}

	/**
	 * Handle click on the popout button.
	 * Determines popout content type and emits the popout request event.
	 */
	private _handlePopoutClick(): void {
		const popout = this._getPopoutContent();
		if (popout) {
			this._onPopoutRequested.fire({
				cellId: this.cellId,
				popout,
			});
		}
	}

	/**
	 * Get the popout content based on output types.
	 * Priority:
	 * - If any output contains a plot image, return the first plot
	 * - If any output contains HTML/webview content, return the first HTML
	 * - If all outputs are text only, return concatenated text (stripped of ANSI)
	 * - If outputs contain only errors, return undefined (no popout available)
	 */
	private _getPopoutContent(): PopoutType | undefined {
		// First pass: look for plot images
		for (const output of this._outputs) {
			for (const item of output.items) {
				if (item.mime.startsWith('image/')) {
					const dataUrl = item.data.startsWith('data:')
						? item.data
						: `data:${item.mime};base64,${item.data}`;
					return { type: 'plot', dataUrl, mimeType: item.mime };
				}
			}
		}

		// Second pass: look for webview outputs
		// For webview outputs, return the raw data so it can be rendered using
		// the notebook output webview service (same rendering as inline output)
		for (const output of this._outputs) {
			if (output.webviewMetadata?.webviewType && output.webviewMetadata.rawData) {
				return {
					type: 'webview',
					rawData: output.webviewMetadata.rawData,
					outputId: output.outputId,
				};
			}
		}

		// Third pass: look for regular HTML content in output items
		for (const output of this._outputs) {
			for (const item of output.items) {
				if (item.mime === 'text/html') {
					return { type: 'html', html: item.data };
				}
			}
		}

		// Fourth pass: collect text content (only if no images, webview, or HTML found)
		const textParts: string[] = [];
		let hasNonErrorContent = false;

		for (const output of this._outputs) {
			for (const item of output.items) {
				if (item.mime === 'application/vnd.code.notebook.error') {
					// Skip error content for popout - we only want text output
					continue;
				}
				const text = this._extractTextFromItem(item);
				if (text) {
					// Strip ANSI escape sequences for popout
					textParts.push(this._stripAnsi(text));
					hasNonErrorContent = true;
				}
			}
		}

		// Only return text if we have non-error content
		if (hasNonErrorContent && textParts.length > 0) {
			return { type: 'text', text: textParts.join('\n') };
		}

		// No popout available (only errors or empty)
		return undefined;
	}

	/**
	 * Strip ANSI escape sequences from text.
	 */
	private _stripAnsi(text: string): string {

		return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
	}

	/**
	 * Check if popout is available for the current outputs.
	 * Returns true if there's any plot, HTML, or text content (not just errors).
	 */
	hasPopoutContent(): boolean {
		// For webview outputs, we always have popout content (the HTML representation)
		const hasWebview = this._outputs.some(output => output.webviewMetadata?.webviewType);
		if (hasWebview) {
			return true;
		}
		return this._getPopoutContent() !== undefined;
	}

	/**
	 * Get the popout content for external callers.
	 */
	getPopoutContent(): PopoutType | undefined {
		return this._getPopoutContent();
	}

	/**
	 * Get the content to copy from the outputs.
	 * Priority:
	 * - If any output contains an image, copy the first image
	 * - Otherwise, concatenate all text content
	 */
	private _getContentToCopy(): CopyOutputContent | undefined {
		// First pass: look for images
		for (const output of this._outputs) {
			for (const item of output.items) {
				if (item.mime.startsWith('image/')) {
					// Return the first image found
					const dataUrl = item.data.startsWith('data:')
						? item.data
						: `data:${item.mime};base64,${item.data}`;
					return { type: 'image', dataUrl };
				}
			}
		}

		// Second pass: collect all text content
		const textParts: string[] = [];
		for (const output of this._outputs) {
			for (const item of output.items) {
				const text = this._extractTextFromItem(item);
				if (text) {
					textParts.push(text);
				}
			}
		}

		if (textParts.length > 0) {
			return { type: 'text', text: textParts.join('\n') };
		}

		return undefined;
	}

	/**
	 * Extract text content from an output item.
	 */
	private _extractTextFromItem(item: ICellOutputItem): string | undefined {
		const { mime, data } = item;

		if (mime === 'application/vnd.code.notebook.stdout' ||
			mime === 'text/plain' ||
			mime === 'application/vnd.code.notebook.stderr') {
			return data;
		}

		if (mime === 'application/vnd.code.notebook.error') {
			try {
				const errorData = JSON.parse(data);
				const parts: string[] = [];
				if (errorData.name) {
					parts.push(`${errorData.name}: ${errorData.message || ''}`);
				} else if (errorData.message) {
					parts.push(errorData.message);
				}
				if (errorData.stack) {
					parts.push(errorData.stack);
				}
				return parts.join('\n');
			} catch {
				return data;
			}
		}

		if (mime === 'text/markdown') {
			return data;
		}

		return undefined;
	}

	/**
	 * Show visual feedback that the copy was successful.
	 * Changes the copy button icon to a green checkmark briefly.
	 */
	showCopySuccess(): void {
		// Clear any existing timeout
		if (this._copyButtonTimeout) {
			clearTimeout(this._copyButtonTimeout);
		}

		// Change to check icon with success styling
		this._copyButtonIcon.className = ThemeIcon.asClassName(Codicon.check);
		this._copyButton.classList.add('copy-success');

		// Revert back to copy icon after a delay
		this._copyButtonTimeout = setTimeout(() => {
			this._copyButtonIcon.className = ThemeIcon.asClassName(Codicon.copy);
			this._copyButton.classList.remove('copy-success');
			this._copyButtonTimeout = undefined;
		}, 1500);
	}

	/**
	 * Check if there is any content that can be copied.
	 */
	hasCopiableContent(): boolean {
		return this._getContentToCopy() !== undefined;
	}

	/**
	 * Check if the output contains exactly one plot/image.
	 * Returns true only if there is exactly one image output item across all outputs.
	 */
	hasSinglePlot(): boolean {
		return this._getSinglePlotInfo() !== undefined;
	}

	/**
	 * Get the single plot info if exactly one plot exists.
	 * Returns undefined if there are zero or more than one images.
	 */
	getSinglePlotInfo(): { dataUrl: string; mimeType: string } | undefined {
		return this._getSinglePlotInfo();
	}

	/**
	 * Get info about the single plot if exactly one exists.
	 * Used internally for the save button logic.
	 */
	private _getSinglePlotInfo(): { dataUrl: string; mimeType: string } | undefined {
		let imageCount = 0;
		let imageInfo: { dataUrl: string; mimeType: string } | undefined;

		for (const output of this._outputs) {
			for (const item of output.items) {
				if (item.mime.startsWith('image/')) {
					imageCount++;
					if (imageCount > 1) {
						// More than one image - return undefined
						return undefined;
					}
					// Build the data URL
					const dataUrl = item.data.startsWith('data:')
						? item.data
						: `data:${item.mime};base64,${item.data}`;
					imageInfo = { dataUrl, mimeType: item.mime };
				}
			}
		}

		// Return the info only if exactly one image was found
		return imageCount === 1 ? imageInfo : undefined;
	}

	private _setupKeyboardNavigation(): void {
		this._styledContainer.addEventListener('keydown', (e) => {
			switch (e.key) {
				case 'Escape':
					// Return focus to editor
					this._editor.focus();
					e.preventDefault();
					break;
				case 'Delete':
				case 'Backspace':
					if (e.ctrlKey || e.metaKey) {
						this.clearOutputs();
						e.preventDefault();
					}
					break;
			}
		});
	}

	/**
	 * Set up mouse/pointer event handling to enable text selection within the view zone.
	 * With z-index set in CSS, the view zone now sits above Monaco's view-lines element,
	 * so we just need to stop propagation to prevent Monaco from handling the events.
	 */
	private _setupTextSelection(): void {
		// Stop propagation of mouse events on the output container to allow
		// native browser text selection instead of Monaco's handling
		const stopEvent = (e: Event) => {
			e.stopPropagation();
		};

		this._outputContainer.addEventListener('mousedown', stopEvent);
		this._outputContainer.addEventListener('mousemove', stopEvent);
		this._outputContainer.addEventListener('mouseup', stopEvent);
		this._outputContainer.addEventListener('pointerdown', stopEvent);
		this._outputContainer.addEventListener('pointermove', stopEvent);
		this._outputContainer.addEventListener('pointerup', stopEvent);
	}

	private _setupResizeObserver(): void {
		if (this._resizeObserver) {
			return;
		}

		this._resizeObserver = new ResizeObserver(() => {
			this._updateHeight();
		});

		this._resizeObserver.observe(this._outputContainer);
	}

	private _disposeResizeObserver(): void {
		if (this._resizeObserver) {
			this._resizeObserver.disconnect();
			this._resizeObserver = undefined;
		}
	}

	/**
	 * Re-layout all webviews when the view zone position changes.
	 * Called by onDomNodeTop during scrolling for immediate updates.
	 */
	private _layoutAllWebviews(): void {
		if (!this._clippingContainer) {
			this._clippingContainer = this._editor.getContainerDomNode();
		}
		for (const [outputId, webview] of this._webviewsByOutputId) {
			const container = this._webviewContainersByOutputId.get(outputId);
			if (container) {
				webview.webview.layoutWebviewOverElement(container, undefined, this._clippingContainer);
			}
		}
	}

	private _renderAllOutputs(): void {
		dom.clearNode(this._outputContainer);

		// Check if all outputs are errors only
		const isErrorOnly = this._isErrorOnly();
		this._styledContainer.classList.toggle('quarto-output-error-only', isErrorOnly);

		for (const output of this._outputs) {
			this._renderOutput(output);
		}
	}

	/**
	 * Check if all outputs contain only error items.
	 */
	private _isErrorOnly(): boolean {
		if (this._outputs.length === 0) {
			return false;
		}
		return this._outputs.every(output =>
			output.items.length > 0 &&
			output.items.every(item => item.mime === 'application/vnd.code.notebook.error')
		);
	}

	private _renderOutput(output: ICellOutput): void {
		const outputElement = document.createElement('div');
		outputElement.className = 'quarto-output-item';
		outputElement.setAttribute('role', 'log');

		// Check if this output needs webview rendering
		if (output.webviewMetadata?.webviewType && this._webviewService && this._session) {
			// Render via webview for interactive/complex outputs
			this._renderWebviewOutput(output, outputElement);
		} else {
			// Render items normally
			for (const item of output.items) {
				const rendered = this._renderOutputItem(item, output);
				if (rendered) {
					outputElement.appendChild(rendered);
				}
			}
		}

		this._outputContainer.appendChild(outputElement);
	}

	private _renderOutputItem(item: ICellOutputItem, output: ICellOutput): HTMLElement | null {
		const { mime, data } = item;

		// Handle different MIME types
		if (mime === 'application/vnd.code.notebook.stdout' || mime === 'text/plain') {
			return this._renderText(data, 'stdout');
		}

		if (mime === 'application/vnd.code.notebook.stderr') {
			return this._renderText(data, 'stderr');
		}

		if (mime === 'application/vnd.code.notebook.error') {
			return this._renderError(data);
		}

		if (mime.startsWith('image/')) {
			return this._renderImage(mime, data);
		}

		if (mime === 'text/html') {
			return this._renderHtml(data, output);
		}

		if (mime === 'text/markdown') {
			// For now, render markdown as plain text
			// Full markdown rendering can be added in a future phase
			return this._renderText(data, 'stdout');
		}

		// Fallback: render as text if possible
		if (typeof data === 'string') {
			return this._renderText(data, 'stdout');
		}

		return null;
	}

	private _renderText(content: string, type: 'stdout' | 'stderr'): HTMLElement {
		const container = document.createElement('div');
		container.className = `quarto-output-${type}`;
		container.setAttribute('role', 'log');

		// Process ANSI escape sequences
		const outputLines = ANSIOutput.processOutput(content);
		const totalLines = outputLines.length;

		// Check if we need to truncate
		if (totalLines > this._maxLines) {
			const omittedCount = totalLines - this._maxLines;

			// Create truncation header
			const truncationHeader = document.createElement('div');
			truncationHeader.className = 'quarto-output-truncation-header';

			// Create the text span
			const textSpan = document.createElement('span');
			textSpan.textContent = `...${omittedCount.toLocaleString()} ${omittedCount === 1 ? 'line' : 'lines'} omitted `;

			// Create the clickable link
			const openLink = document.createElement('a');
			openLink.className = 'quarto-output-open-in-editor';
			openLink.textContent = '(open in editor)';
			openLink.href = '#';
			openLink.setAttribute('role', 'button');
			openLink.setAttribute('aria-label', localize('openFullOutput', 'Open full output in editor'));
			openLink.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				// Trigger popout with the full text (stripped of ANSI)
				this._onPopoutRequested.fire({
					cellId: this.cellId,
					popout: { type: 'text', text: this._stripAnsi(content) },
				});
			});

			truncationHeader.appendChild(textSpan);
			truncationHeader.appendChild(openLink);
			container.appendChild(truncationHeader);

			// Render only the last maxLines lines
			const truncatedLines = outputLines.slice(-this._maxLines);

			// Create a container for the truncated content with gradient on first line
			const truncatedContainer = document.createElement('div');
			truncatedContainer.className = 'quarto-output-truncated-content';

			this._renderAnsiOutputLines(truncatedLines, truncatedContainer);

			// Apply gradient to first line
			if (truncatedContainer.firstElementChild) {
				truncatedContainer.firstElementChild.classList.add('quarto-output-first-line-gradient');
			}

			container.appendChild(truncatedContainer);
		} else {
			// No truncation needed - render all lines
			this._renderAnsiOutputLines(outputLines, container);
		}

		return container;
	}

	/**
	 * Render ANSI output lines into a container element.
	 */
	private _renderAnsiOutputLines(outputLines: readonly ANSIOutputLine[], container: HTMLElement): void {
		for (const outputLine of outputLines) {
			if (outputLine.outputRuns.length === 0) {
				// Empty line
				container.appendChild(document.createElement('br'));
			} else {
				const lineDiv = document.createElement('div');
				for (const run of outputLine.outputRuns) {
					const span = this._renderAnsiRun(run);
					lineDiv.appendChild(span);
				}
				container.appendChild(lineDiv);
			}
		}
	}

	/**
	 * Render a single ANSI output run as a styled span.
	 */
	private _renderAnsiRun(run: ANSIOutputRun): HTMLElement {
		const span = document.createElement('span');
		span.textContent = run.text;

		if (run.format) {
			// Apply styles
			if (run.format.styles) {
				for (const style of run.format.styles) {
					this._applyAnsiStyle(span, style);
				}
			}

			// Apply foreground color
			if (run.format.foregroundColor) {
				const color = this._resolveAnsiColor(run.format.foregroundColor, 'foreground');
				if (color) {
					span.style.color = color;
				}
			}

			// Apply background color
			if (run.format.backgroundColor) {
				const color = this._resolveAnsiColor(run.format.backgroundColor, 'background');
				if (color) {
					span.style.backgroundColor = color;
				}
			}
		}

		return span;
	}

	/**
	 * Apply an ANSI style to an element.
	 */
	private _applyAnsiStyle(element: HTMLElement, style: ANSIStyle): void {
		switch (style) {
			case ANSIStyle.Bold:
				element.style.fontWeight = 'bold';
				break;
			case ANSIStyle.Dim:
				element.style.fontWeight = 'lighter';
				break;
			case ANSIStyle.Italic:
				element.style.fontStyle = 'italic';
				break;
			case ANSIStyle.Underlined:
				element.style.textDecoration = 'underline';
				break;
			case ANSIStyle.DoubleUnderlined:
				element.style.textDecoration = 'underline double';
				break;
			case ANSIStyle.CrossedOut:
				element.style.textDecoration = 'line-through';
				break;
			case ANSIStyle.Hidden:
				element.style.visibility = 'hidden';
				break;
		}
	}

	/**
	 * Resolve an ANSI color to a CSS color value.
	 */
	private _resolveAnsiColor(color: ANSIColor | string, type: 'foreground' | 'background'): string | undefined {
		// If it's a string starting with #, it's an RGB color
		if (typeof color === 'string' && color.startsWith('#')) {
			return color;
		}

		// Map ANSI colors to CSS variables
		switch (color) {
			case ANSIColor.Black:
			case ANSIColor.Red:
			case ANSIColor.Green:
			case ANSIColor.Yellow:
			case ANSIColor.Blue:
			case ANSIColor.Magenta:
			case ANSIColor.Cyan:
			case ANSIColor.White:
			case ANSIColor.BrightBlack:
			case ANSIColor.BrightRed:
			case ANSIColor.BrightGreen:
			case ANSIColor.BrightYellow:
			case ANSIColor.BrightBlue:
			case ANSIColor.BrightMagenta:
			case ANSIColor.BrightCyan:
			case ANSIColor.BrightWhite:
				return `var(--vscode-positronConsole-${color})`;
			default:
				// Unknown color type
				if (typeof color === 'string') {
					return color;
				}
				return undefined;
		}
	}

	private _renderError(data: string): HTMLElement {
		const container = document.createElement('div');
		container.className = 'quarto-output-error';
		container.setAttribute('role', 'alert');

		let errorText: string;
		try {
			const errorData = JSON.parse(data);

			// Format error output
			const parts: string[] = [];
			if (errorData.name) {
				parts.push(`${errorData.name}: ${errorData.message || ''}`);
			} else if (errorData.message) {
				parts.push(errorData.message);
			}
			// Only add stack if it's different from the message
			// R sometimes sends the error message in both fields
			if (errorData.stack && errorData.stack.trim() !== (errorData.message || '').trim()) {
				parts.push(errorData.stack);
			}

			errorText = parts.join('\n');
		} catch {
			// If not JSON, render as plain text
			errorText = data;
		}

		// Process ANSI escape sequences in error output
		const pre = document.createElement('pre');
		const outputLines = ANSIOutput.processOutput(errorText);
		this._renderAnsiOutputLines(outputLines, pre);
		container.appendChild(pre);

		return container;
	}

	private _renderImage(mime: string, data: string): HTMLElement {
		const container = document.createElement('div');
		container.className = 'quarto-output-image-container';

		const img = document.createElement('img');
		img.className = 'quarto-output-image';
		img.setAttribute('alt', localize('outputImage', 'Output image'));

		// Check if data is already a data URL
		if (data.startsWith('data:')) {
			img.src = data;
		} else {
			// Assume base64 encoded
			img.src = `data:${mime};base64,${data}`;
		}

		container.appendChild(img);
		return container;
	}

	private _renderHtml(content: string, output: ICellOutput): HTMLElement {
		const container = document.createElement('div');
		container.className = 'quarto-output-html';

		// For security, only render safe HTML (no scripts)
		if (this._isSafeHtml(content)) {
			safeSetInnerHtml(container, content);
		} else if (this._webviewService && this._session) {
			// Use webview for unsafe HTML content
			container.className = 'quarto-output-webview-container';
			this._renderHtmlInWebview(content, output, container);
		} else {
			// If HTML contains scripts and no webview service available,
			// render as escaped text with a warning
			const warning = document.createElement('div');
			warning.className = 'quarto-output-warning';
			warning.textContent = localize('unsafeHtml', 'Interactive HTML output (requires webview)');
			container.appendChild(warning);

			const pre = document.createElement('pre');
			pre.className = 'quarto-output-html-escaped';
			pre.textContent = content.substring(0, 500) + (content.length > 500 ? '...' : '');
			container.appendChild(pre);
		}

		return container;
	}

	private _isSafeHtml(html: string): boolean {
		// Simple check for potentially unsafe content
		// Rich/interactive content will be handled by webview
		const unsafePatterns = [
			/<script/i,
			/javascript:/i,
			/on\w+\s*=/i, // onclick, onerror, etc.
			/<iframe/i,
			/<object/i,
			/<embed/i,
		];

		return !unsafePatterns.some(pattern => pattern.test(html));
	}

	/**
	 * Render an output using a webview.
	 * Used for interactive plots, widgets, and complex HTML.
	 */
	private async _renderWebviewOutput(output: ICellOutput, container: HTMLElement): Promise<void> {
		if (!this._webviewService || !this._session || !output.webviewMetadata) {
			return;
		}

		// Create a placeholder container for the webview
		const webviewContainer = document.createElement('div');
		webviewContainer.className = 'quarto-output-webview-container';
		webviewContainer.style.minHeight = '100px';
		webviewContainer.setAttribute('data-output-id', output.outputId);
		container.appendChild(webviewContainer);

		// Show loading indicator
		const loadingIndicator = document.createElement('div');
		loadingIndicator.className = 'quarto-output-loading';
		loadingIndicator.textContent = localize('loadingOutput', 'Loading output...');
		webviewContainer.appendChild(loadingIndicator);

		try {
			// Construct the runtime message from our stored metadata
			const runtimeMessage = this._createRuntimeMessage(output);

			// Create the webview
			const webview = await this._webviewService.createNotebookOutputWebview({
				id: output.outputId,
				runtime: this._session,
				output: runtimeMessage,
				viewType: 'jupyter-notebook', // Use jupyter-notebook to get standard renderers
			});

			if (!webview) {
				// No renderer available - show fallback
				this._showWebviewFallback(webviewContainer, output);
				return;
			}

			// Store the webview and container for later cleanup and scroll updates
			this._webviewsByOutputId.set(output.outputId, webview);
			this._webviewContainersByOutputId.set(output.outputId, webviewContainer);
			this._webviewDisposables.add(webview);

			// Remove loading indicator
			webviewContainer.removeChild(loadingIndicator);

			// Cache the clipping container for use during scroll updates
			if (!this._clippingContainer) {
				this._clippingContainer = this._editor.getContainerDomNode();
			}

			// Claim and position the webview
			const editorWindow = dom.getWindow(this.domNode);
			webview.webview.claim(this, editorWindow, undefined);
			webview.webview.layoutWebviewOverElement(webviewContainer, undefined, this._clippingContainer);

			// Listen for webview messages to get the actual content height
			// The webview sends webviewMetrics messages with bodyScrollHeight when content loads/resizes
			this._webviewDisposables.add(webview.webview.onMessage(({ message }) => {
				if (isHTMLOutputWebviewMessage(message) && webviewContainer) {
					// Set the container height to match the webview content height
					// Cap at a reasonable maximum to prevent extremely tall outputs
					const maxHeight = 800;
					const boundedHeight = Math.min(message.bodyScrollHeight, maxHeight);
					webviewContainer.style.height = `${boundedHeight}px`;
					// Update the view zone height and re-layout the webview
					this._updateHeight();
					webview.webview.layoutWebviewOverElement(webviewContainer, undefined, this._clippingContainer);
				}
			}));

			// Update height when webview renders
			this._webviewDisposables.add(webview.onDidRender(() => {
				this._updateHeight();
			}));

			// Handle scroll events - update webview position
			// Note: onDomNodeTop provides more immediate updates during scrolling,
			// but we keep this as a backup for any scroll events that might be missed
			this._webviewDisposables.add(this._editor.onDidScrollChange(() => {
				if (this._zoneId) {
					webview.webview.layoutWebviewOverElement(webviewContainer, undefined, this._clippingContainer);
				}
			}));

		} catch (error) {
			// Show error message
			webviewContainer.removeChild(loadingIndicator);
			const errorDiv = document.createElement('div');
			errorDiv.className = 'quarto-output-error';
			errorDiv.textContent = localize('webviewError', 'Failed to render output: {0}', String(error));
			webviewContainer.appendChild(errorDiv);
		}
	}

	/**
	 * Render HTML content in a webview.
	 * Used for unsafe HTML that requires sandboxed rendering.
	 */
	private async _renderHtmlInWebview(content: string, output: ICellOutput, container: HTMLElement): Promise<void> {
		if (!this._webviewService || !this._session) {
			return;
		}

		// Show loading indicator
		const loadingIndicator = document.createElement('div');
		loadingIndicator.className = 'quarto-output-loading';
		loadingIndicator.textContent = localize('loadingOutput', 'Loading output...');
		container.appendChild(loadingIndicator);

		try {
			// Create a runtime message for the HTML content
			const runtimeMessage: ILanguageRuntimeMessageWebOutput = {
				id: output.outputId,
				parent_id: '',
				when: new Date().toISOString(),
				type: LanguageRuntimeMessageType.Output,
				event_clock: 0,
				kind: RuntimeOutputKind.ViewerWidget,
				data: { 'text/html': content },
				output_location: PositronOutputLocation.Console,
				resource_roots: undefined,
			};

			// Create the webview
			const webview = await this._webviewService.createNotebookOutputWebview({
				id: output.outputId,
				runtime: this._session,
				output: runtimeMessage,
				viewType: 'jupyter-notebook',
			});

			if (!webview) {
				// No renderer available - show the HTML escaped
				container.removeChild(loadingIndicator);
				const pre = document.createElement('pre');
				pre.className = 'quarto-output-html-escaped';
				pre.textContent = content.substring(0, 1000) + (content.length > 1000 ? '...' : '');
				container.appendChild(pre);
				return;
			}

			// Store the webview and container for later cleanup and scroll updates
			this._webviewsByOutputId.set(output.outputId, webview);
			this._webviewContainersByOutputId.set(output.outputId, container);
			this._webviewDisposables.add(webview);

			// Remove loading indicator
			container.removeChild(loadingIndicator);

			// Cache the clipping container for use during scroll updates
			if (!this._clippingContainer) {
				this._clippingContainer = this._editor.getContainerDomNode();
			}

			// Claim and position the webview
			const editorWindow = dom.getWindow(this.domNode);
			webview.webview.claim(this, editorWindow, undefined);
			webview.webview.layoutWebviewOverElement(container, undefined, this._clippingContainer);

			// Listen for webview messages to get the actual content height
			this._webviewDisposables.add(webview.webview.onMessage(({ message }) => {
				if (isHTMLOutputWebviewMessage(message) && container) {
					const maxHeight = 800;
					const boundedHeight = Math.min(message.bodyScrollHeight, maxHeight);
					container.style.height = `${boundedHeight}px`;
					this._updateHeight();
					webview.webview.layoutWebviewOverElement(container, undefined, this._clippingContainer);
				}
			}));

			// Update height when webview renders
			this._webviewDisposables.add(webview.onDidRender(() => {
				this._updateHeight();
			}));

			// Handle scroll events
			// Note: onDomNodeTop provides more immediate updates during scrolling,
			// but we keep this as a backup for any scroll events that might be missed
			this._webviewDisposables.add(this._editor.onDidScrollChange(() => {
				if (this._zoneId) {
					webview.webview.layoutWebviewOverElement(container, undefined, this._clippingContainer);
				}
			}));

		} catch (error) {
			container.removeChild(loadingIndicator);
			const errorDiv = document.createElement('div');
			errorDiv.className = 'quarto-output-error';
			errorDiv.textContent = localize('webviewError', 'Failed to render HTML: {0}', String(error));
			container.appendChild(errorDiv);
		}
	}

	/**
	 * Create a runtime message from output metadata for webview rendering.
	 */
	private _createRuntimeMessage(output: ICellOutput): ILanguageRuntimeMessageWebOutput {
		const metadata = output.webviewMetadata;
		const rawData = metadata?.rawData ?? {};

		// Determine the output kind based on webview type
		let kind = RuntimeOutputKind.ViewerWidget;
		if (metadata?.webviewType === 'widget') {
			kind = RuntimeOutputKind.IPyWidget;
		} else if (metadata?.webviewType === 'display') {
			kind = RuntimeOutputKind.PlotWidget;
		}

		// Convert rawData to ILanguageRuntimeMessageOutputData format
		const data: Record<string, unknown> = {};
		for (const [mime, value] of Object.entries(rawData)) {
			data[mime] = value;
		}

		// Parse resource roots if available
		const resourceRoots = metadata?.resourceRoots?.map(r => {
			try {
				return URI.parse(r).toJSON();
			} catch {
				return URI.file(r).toJSON();
			}
		});

		return {
			id: output.outputId,
			parent_id: '',
			when: new Date().toISOString(),
			type: LanguageRuntimeMessageType.Output,
			event_clock: 0,
			kind,
			data,
			output_location: PositronOutputLocation.Console,
			resource_roots: resourceRoots,
		};
	}

	/**
	 * Show a fallback when webview rendering is not available.
	 */
	private _showWebviewFallback(container: HTMLElement, output: ICellOutput): void {
		// Remove any existing content
		dom.clearNode(container);

		// Show a message that the output requires webview
		const warning = document.createElement('div');
		warning.className = 'quarto-output-warning';
		warning.textContent = localize('webviewNotAvailable', 'Interactive output cannot be displayed (no renderer available)');
		container.appendChild(warning);

		// Try to show a text representation if available
		const textItem = output.items.find(item =>
			item.mime === 'text/plain' ||
			item.mime === 'application/vnd.code.notebook.stdout'
		);

		if (textItem) {
			const pre = document.createElement('pre');
			pre.className = 'quarto-output-stdout';
			pre.textContent = textItem.data;
			container.appendChild(pre);
		}
	}

	private _updateHeight(): void {
		// Measure the styled container's height (content + padding + border, but not margin)
		const styledHeight = this._styledContainer.offsetHeight;

		// Show the Copy button if there's enough room and there's copiable content
		// Copy is prioritized (shown first) since it's the most common action
		this._copyButton.style.display = styledHeight > 40 && this.hasCopiableContent() ? 'block' : 'none';

		// Show the Popout button if there's more room and there's popout content
		// (not just errors - plot, HTML, or text content)
		this._popoutButton.style.display = styledHeight > 60 && this.hasPopoutContent() ? 'block' : 'none';

		// Show the Save button if there's even more room and there's exactly one plot
		this._saveButton.style.display = styledHeight > 80 && this.hasSinglePlot() ? 'block' : 'none';

		// Add margin space (4px top + 4px bottom) plus 5px spacing below the widget
		const newHeight = Math.max(MIN_VIEW_ZONE_HEIGHT, styledHeight + 13);

		if (newHeight !== this.heightInPx && this._zoneId) {
			this.heightInPx = newHeight;

			// Update the zone height
			this._editor.changeViewZones(accessor => {
				accessor.removeZone(this._zoneId!);
				this._zoneId = accessor.addZone(this);
			});
			// Re-apply width after zone is re-added
			this._applyWidth();
		} else if (!this._zoneId) {
			this.heightInPx = newHeight;
		}
	}

	private _announceOutput(output: ICellOutput): void {
		// Create a live region announcement for screen readers
		const announcement = this._getOutputAnnouncement(output);
		if (announcement) {
			ariaStatus(announcement);
		}
	}

	private _getOutputAnnouncement(output: ICellOutput): string | undefined {
		for (const item of output.items) {
			if (item.mime === 'application/vnd.code.notebook.error') {
				return localize('errorOutput', 'Error output received');
			}
			if (item.mime.startsWith('image/')) {
				return localize('imageOutput', 'Image output received');
			}
			if (item.mime === 'text/plain' || item.mime === 'application/vnd.code.notebook.stdout') {
				// Truncate long text for announcement
				const text = item.data.substring(0, 100);
				return text + (item.data.length > 100 ? '...' : '');
			}
		}
		return undefined;
	}
}
