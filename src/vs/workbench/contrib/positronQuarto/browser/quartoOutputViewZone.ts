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
	public readonly suppressMouseDown = false;

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

	// Callback when outputs are cleared by user action
	private _onClear: (() => void) | undefined;

	// Callback when execution should be interrupted
	private _onInterrupt: (() => void) | undefined;

	// Whether the cell is currently executing
	private _isExecuting = false;

	// Inner styled container (separate from domNode so Monaco's height doesn't stretch it)
	private readonly _styledContainer: HTMLElement;

	// Icon element inside the close button (for switching between close and stop icons)
	private _buttonIcon!: HTMLSpanElement;

	constructor(
		private readonly _editor: ICodeEditor,
		public readonly cellId: string,
		afterLine: number,
		webviewService?: IPositronNotebookOutputWebviewService,
		session?: ILanguageRuntimeSession,
	) {
		super();

		this._webviewService = webviewService;
		this._session = session;

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

		// Create close button
		this._closeButton = this._createCloseButton();
		this._styledContainer.appendChild(this._closeButton);

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
	 */
	setSession(session: ILanguageRuntimeSession | undefined): void {
		this._session = session;
	}

	/**
	 * Add an output to the view zone.
	 */
	addOutput(output: ICellOutput): void {
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
		this._renderAnsiOutputLines(outputLines, container);

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
			if (errorData.stack) {
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

			// Store the webview for later cleanup
			this._webviewsByOutputId.set(output.outputId, webview);
			this._webviewDisposables.add(webview);

			// Remove loading indicator
			webviewContainer.removeChild(loadingIndicator);

			// Claim and position the webview
			const editorWindow = dom.getWindow(this.domNode);
			const clippingContainer = this._editor.getContainerDomNode();
			webview.webview.claim(this, editorWindow, undefined);
			webview.webview.layoutWebviewOverElement(webviewContainer, undefined, clippingContainer);

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
					webview.webview.layoutWebviewOverElement(webviewContainer, undefined, clippingContainer);
				}
			}));

			// Update height when webview renders
			this._webviewDisposables.add(webview.onDidRender(() => {
				this._updateHeight();
			}));

			// Handle scroll events - update webview position
			this._webviewDisposables.add(this._editor.onDidScrollChange(() => {
				if (this._zoneId) {
					webview.webview.layoutWebviewOverElement(webviewContainer, undefined, clippingContainer);
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

			// Store the webview for later cleanup
			this._webviewsByOutputId.set(output.outputId, webview);
			this._webviewDisposables.add(webview);

			// Remove loading indicator
			container.removeChild(loadingIndicator);

			// Claim and position the webview
			const editorWindow = dom.getWindow(this.domNode);
			const clippingContainer = this._editor.getContainerDomNode();
			webview.webview.claim(this, editorWindow, undefined);
			webview.webview.layoutWebviewOverElement(container, undefined, clippingContainer);

			// Listen for webview messages to get the actual content height
			this._webviewDisposables.add(webview.webview.onMessage(({ message }) => {
				if (isHTMLOutputWebviewMessage(message) && container) {
					const maxHeight = 800;
					const boundedHeight = Math.min(message.bodyScrollHeight, maxHeight);
					container.style.height = `${boundedHeight}px`;
					this._updateHeight();
					webview.webview.layoutWebviewOverElement(container, undefined, clippingContainer);
				}
			}));

			// Update height when webview renders
			this._webviewDisposables.add(webview.onDidRender(() => {
				this._updateHeight();
			}));

			// Handle scroll events
			this._webviewDisposables.add(this._editor.onDidScrollChange(() => {
				if (this._zoneId) {
					webview.webview.layoutWebviewOverElement(container, undefined, clippingContainer);
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
