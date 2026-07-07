/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns, local/code-amd-node-module
import * as React from 'react';
import * as dom from '../../../../base/browser/dom.js';
import { safeSetInnerHtml } from '../../../../base/browser/domSanitize.js';
import { status as ariaStatus } from '../../../../base/browser/ui/aria/aria.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IViewZone, MouseTargetType } from '../../../../editor/browser/editorBrowser.js';
import { localize } from '../../../../nls.js';
import { ICellOutput, ICellOutputItem, DATA_EXPLORER_MIME_TYPE, CellExecutionState } from '../common/quartoExecutionTypes.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { formatCellDuration, getRelativeTime } from '../../positronNotebook/browser/notebookCells/cellExecutionUtils.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Event as VSEvent, Emitter } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { dirname } from '../../../../base/common/resources.js';
import { Schemas } from '../../../../base/common/network.js';
import { INotebookOutputWebview, IPositronNotebookOutputWebviewService } from '../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { isHTMLOutputWebviewMessage } from '../../positronWebviewPreloads/browser/notebookOutputUtils.js';
import { ILanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { RuntimeOutputKind, ILanguageRuntimeMessageWebOutput, PositronOutputLocation, LanguageRuntimeMessageType, ILanguageRuntimeResourceUsage } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { EditorLayoutInfo, EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { applyFontInfo } from '../../../../editor/browser/config/domFontInfo.js';
import { ANSIOutput, ANSIOutputLine, ANSIOutputRun } from '../../../../base/common/ansiOutput.js';
import { computeAnsiStyles, resolveAnsiColor } from '../../../../base/common/ansiStyles.js';
import { PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { POSITRON_NOTEBOOK_INLINE_DATA_EXPLORER_ENABLED_KEY, POSITRON_NOTEBOOK_INLINE_DATA_EXPLORER_MAX_HEIGHT_KEY } from '../../positronNotebook/common/positronNotebookConfig.js';
import { QuartoInlineDataExplorer } from './quartoInlineDataExplorer.js';
import { parseVariablePath } from '../../../services/positronDataExplorer/common/utils.js';
import { calculateInlineDataExplorerHeight } from './quartoInlineDataExplorerLayout.js';
import { ResourceUsageGraph } from '../../positronConsole/browser/components/resourceUsageGraph.js';
import { IResourceUsageHistoryService } from '../../../services/positronConsole/browser/resourceUsageHistoryService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IManagedHover } from '../../../../base/browser/ui/hover/hover.js';

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
	/** Configuration service for reading settings */
	readonly configurationService?: IConfigurationService;
	/** Document URI for this view zone's Quarto document */
	readonly documentUri?: URI;
}

/**
 * Whether an inline-output webview's overlay should be shown for a view zone in
 * its current scroll state.
 *
 * Inline output webviews are absolutely positioned (via CSS anchor positioning)
 * over a placeholder element inside the editor's view zone, but the webview
 * itself is mounted at the workbench root so it can't be clipped by normal
 * editor scrolling. When the placeholder is not actually on-screen the
 * fixed-position overlay falls back to a static position and "sticks" in the
 * corner of the editor (see posit-dev/positron#13978).
 *
 * The reliable signal for "the placeholder is on-screen" is Monaco's own
 * `monaco-visible-view-zone` attribute: Monaco adds it to (and removes it from)
 * the view zone's DOM node in its render pass, based on whether the zone's
 * whitespace intersects the viewport. Crucially it is updated BEFORE Monaco
 * calls `onDomNodeTop` and BEFORE it applies the zone's new `display`/position,
 * so reading it during a scroll handler is fresh.
 *
 * A geometry probe such as `getClientRects().length > 0` is not a substitute: it
 * is one frame stale during scroll, and it stays truthy for a zone that has
 * merely scrolled out of the editor viewport while Monaco still renders it -- in
 * which case anchor positioning has already fallen back to the corner. An
 * interactive widget tends to emit follow-up layout events that incidentally
 * re-hide the overlay, but a static output such as a flextable table does not,
 * so it stays stuck.
 *
 * @param zoneDomNode the view zone's outer DOM node (carries the attribute).
 * @param anchor the placeholder element the overlay is anchored to.
 * @returns true when the zone is on-screen and the anchor is still attached.
 */
export function isWebviewOverlayShown(zoneDomNode: HTMLElement, anchor: HTMLElement): boolean {
	return zoneDomNode.hasAttribute('monaco-visible-view-zone') && anchor.isConnected;
}

/**
 * Whether a `text/html` output is inert -- free of active content (scripts,
 * iframes, objects, embeds, `javascript:` URLs, inline event handlers) -- and
 * therefore safe to inject directly into the DOM rather than sandboxing it in a
 * webview.
 *
 * Uses substring/pattern matching rather than a parser: a false negative (inert
 * markup treated as active) merely routes to a webview, which still renders,
 * while a false positive would be a security gap, so we err toward "active".
 */
export function isInertHtml(html: string): boolean {
	const activePatterns = [
		/<script/i,
		/javascript:/i,
		/on\w+\s*=/i, // onclick, onerror, etc.
		/<iframe/i,
		/<object/i,
		/<embed/i,
	];
	return !activePatterns.some(pattern => pattern.test(html));
}

/**
 * How a `text/html` output item should be rendered inline in a Quarto output
 * view zone.
 */
export type HtmlRenderMode = 'inline' | 'webview' | 'warning';

/**
 * Decide how to render a `text/html` output item.
 *
 * - `inline`: the HTML is inert, so it is injected directly into the DOM.
 * - `webview`: the HTML has active content and must be sandboxed. The raw-HTML
 *   webview is built from the static HTML alone via `createRawHtmlOutputWebview`
 *   and needs no runtime session. This is what lets cached R HTML widgets (e.g.
 *   highcharter, leaflet) restore as interactive webviews after a reload or
 *   reopen, before any kernel session reattaches (posit-dev/positron#14559).
 * - `warning`: no webview service is available at all, so fall back to escaped
 *   text with a "requires webview" notice.
 *
 * @param html the raw HTML content of the output item.
 * @param hasWebviewService whether a webview service is available to sandbox
 *   active HTML.
 */
export function chooseHtmlRenderMode(html: string, hasWebviewService: boolean): HtmlRenderMode {
	if (isInertHtml(html)) {
		return 'inline';
	}
	return hasWebviewService ? 'webview' : 'warning';
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
		// Monaco updates the zone's visibility attribute before this callback but
		// applies its position afterward; re-check next frame to catch the
		// settled state (matters for static outputs with no follow-up event).
		this._scheduleWebviewLayout();
		this._layoutCollapseButton();
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
	// Pending animation-frame handle for a deferred webview re-layout, used to
	// re-read overlay visibility after Monaco has applied a layout change.
	private _webviewLayoutFrame: number | undefined;
	// Cached clipping container for the editor
	private _clippingContainer: HTMLElement | undefined;

	// React renderers for inline data explorer outputs
	private readonly _reactRenderersByOutputId = new Map<string, PositronReactRenderer>();

	// Configuration service for reading settings
	private readonly _configurationService: IConfigurationService | undefined;

	// Document URI for this view zone's Quarto document
	private _documentUri: URI | undefined;

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

	// Whether this view zone is showing only a status bar (no output content)
	private _isStatusOnly = false;

	// Inner styled container (separate from domNode so Monaco's height doesn't stretch it)
	private readonly _styledContainer: HTMLElement;

	// Status bar element showing execution state, duration, and timestamp
	private readonly _statusBar: HTMLElement;
	private readonly _statusIcon: HTMLSpanElement;
	private readonly _statusText: HTMLElement;

	// Resource usage sparkline shown during execution
	private readonly _sparklineContainer: HTMLElement;
	private readonly _cpuLabel: HTMLSpanElement;
	private _sparklineRenderer: PositronReactRenderer | undefined;
	private readonly _resourceUsageDisposables = this._register(new DisposableStore());
	private _resourceUsageData: ILanguageRuntimeResourceUsage[] = [];
	private _sparklineGeneration = 0;
	private _sparklineDelayTimeout: ReturnType<typeof setTimeout> | undefined;
	private _sparklineFadeOutTimeout: ReturnType<typeof setTimeout> | undefined;

	// Live timer interval during execution (window setInterval handle)
	private _timerInterval: number | undefined;
	private _executionStartTime: number | undefined;

	// Subscription to a shared tick event for refreshing the relative timestamp
	private _timestampRefreshDisposable: { dispose(): void } | undefined;

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

	// Collapse state: when true, outputs are hidden and a textual summary is shown
	private _isCollapsed = false;
	// Collapse chevron button (portaled into the editor's container node)
	private readonly _collapseButton: HTMLButtonElement;
	private _collapseChevronIcon!: HTMLSpanElement;
	// Portal parent for the chevron (the editor's container DOM node)
	private _collapseButtonParent: HTMLElement | undefined;
	// Hover state tracked manually since the chevron lives in a separate DOM subtree
	private _wrapperHovered = false;
	private _chevronHovered = false;
	// True when the mouse is over the editor gutter at the vertical position
	// of this view zone. Mirrors Monaco's folding-chevron reveal: hovering
	// anywhere in the gutter next to a foldable region shows its chevron.
	private _gutterHovered = false;
	// Short delay before hiding the chevron so moving between wrapper and chevron doesn't flicker
	private _hideChevronTimeout: ReturnType<typeof setTimeout> | undefined;
	// Summary line element, shown inside the styled container in place of outputs when collapsed
	private readonly _summaryElement: HTMLElement;
	// Cached image natural dimensions for summary generation (keyed by outputId)
	private readonly _imageDimensions = new Map<string, { width: number; height: number }>();
	// Managed hover for the chevron's "Expand Output" / "Collapse Output" tooltip
	private _collapseButtonHover: IManagedHover | undefined;
	// Fires whenever the collapsed state changes. Used by the output manager
	// to persist the state to workspace storage.
	private readonly _onDidChangeCollapsed = this._register(new Emitter<boolean>());
	readonly onDidChangeCollapsed: VSEvent<boolean> = this._onDidChangeCollapsed.event;

	constructor(
		private readonly _editor: ICodeEditor,
		public readonly cellId: string,
		afterLine: number,
		webviewService?: IPositronNotebookOutputWebviewService,
		session?: ILanguageRuntimeSession,
		maxLines: number = 40,
		configurationService?: IConfigurationService,
		documentUri?: URI,
		private readonly _resourceUsageHistoryService?: IResourceUsageHistoryService,
		private readonly _onTimestampTick?: VSEvent<void>,
		private readonly _hoverService?: IHoverService,
	) {
		super();

		this._webviewService = webviewService;
		this._session = session;
		this._maxLines = maxLines;
		this._configurationService = configurationService;
		this._documentUri = documentUri;

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

		// Create status bar for execution info (hidden by default)
		this._statusBar = document.createElement('div');
		this._statusBar.className = 'quarto-output-status-bar';
		this._statusBar.style.display = 'none';
		this._statusIcon = document.createElement('span');
		this._statusIcon.className = 'codicon code-cell-footer-icon';
		this._statusBar.appendChild(this._statusIcon);
		this._statusText = document.createElement('span');
		this._statusText.className = 'code-cell-footer-text';
		this._statusBar.appendChild(this._statusText);
		this._sparklineContainer = document.createElement('div');
		this._sparklineContainer.className = 'quarto-output-sparkline';
		this._sparklineContainer.style.display = 'none';
		this._statusBar.appendChild(this._sparklineContainer);
		this._cpuLabel = document.createElement('span');
		this._cpuLabel.className = 'quarto-output-cpu-label';
		this._cpuLabel.style.display = 'none';
		this._statusBar.appendChild(this._cpuLabel);
		this.domNode.insertBefore(this._statusBar, this._styledContainer);

		// Create output container
		this._outputContainer = document.createElement('div');
		this._outputContainer.className = 'quarto-output-content';
		this._styledContainer.appendChild(this._outputContainer);

		// Create summary element: hidden when expanded, shown when collapsed in
		// place of the outputs. Acts as a clickable region to expand.
		this._summaryElement = document.createElement('div');
		this._summaryElement.className = 'quarto-output-summary';
		this._summaryElement.setAttribute('role', 'button');
		this._summaryElement.setAttribute('tabindex', '0');
		this._summaryElement.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.setCollapsed(false);
		});
		this._summaryElement.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				e.stopPropagation();
				this.setCollapsed(false);
			}
		});
		this._styledContainer.appendChild(this._summaryElement);

		// Create the collapse chevron button. It is NOT appended here: Monaco
		// clips view zone contents horizontally, so to render the chevron
		// visually outside the styled container's left edge (into the gutter
		// area), we portal it into the editor's container node in `show()`
		// and position it via `_layoutCollapseButton()`.
		this._collapseButton = this._createCollapseButton();

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
				this._layoutCollapseButton();
			}
		}));

		// Backup scroll listener for the chevron position. `onDomNodeTop`
		// covers normal vertical scroll, but scrolls that don't move this
		// zone (e.g., horizontal scroll) still need re-layout.
		this._register(this._editor.onDidScrollChange(() => {
			if (this._zoneId) {
				this._layoutCollapseButton();
			}
		}));

		// Content size changes happen when view zones are added / resized.
		// This is the signal that Monaco has recomputed our zone's position,
		// so the chevron's anchor (styledContainer) has a valid rect now.
		this._register(this._editor.onDidContentSizeChange(() => {
			if (this._zoneId) {
				this._layoutCollapseButton();
			}
		}));

		// Folding / unfolding above the zone changes its visual position
		// without necessarily firing onDomNodeTop, so re-layout the chevron
		// when hidden areas change.
		this._register(this._editor.onDidChangeHiddenAreas(() => {
			if (this._zoneId) {
				this._layoutCollapseButton();
				this._scheduleCollapseButtonLayout();
			}
		}));

		// Set up keyboard navigation
		this._setupKeyboardNavigation();

		// Set up mouse event handling for text selection
		this._setupTextSelection();

		// Reveal the chevron while the pointer is in the editor gutter next
		// to this view zone, matching Monaco's folding-chevron behavior
		// (`.margin-view-overlays:hover .codicon` in folding.css). We can't
		// rely on that CSS rule because our chevron is portaled out of
		// `.margin-view-overlays`, so track the gutter hover explicitly.
		this._register(this._editor.onMouseMove((e) => {
			const t = e.target.type;
			const isGutter =
				t === MouseTargetType.GUTTER_GLYPH_MARGIN ||
				t === MouseTargetType.GUTTER_LINE_NUMBERS ||
				t === MouseTargetType.GUTTER_LINE_DECORATIONS ||
				t === MouseTargetType.GUTTER_VIEW_ZONE;
			let gutterHovered = false;
			if (isGutter && this._zoneId) {
				const rect = this.domNode.getBoundingClientRect();
				const mouseY = e.event.browserEvent.clientY;
				gutterHovered = mouseY >= rect.top && mouseY <= rect.bottom;
			}
			if (gutterHovered !== this._gutterHovered) {
				this._gutterHovered = gutterHovered;
				this._updateCollapseButtonVisibility();
			}
		}));
		this._register(this._editor.onMouseLeave(() => {
			if (this._gutterHovered) {
				this._gutterHovered = false;
				this._updateCollapseButtonVisibility();
			}
		}));

		// Track wrapper hover for the portaled chevron's visibility.
		this.domNode.addEventListener('mouseenter', () => {
			this._wrapperHovered = true;
			// Re-layout on hover: Monaco events for view-zone repositioning
			// (folding collapse/expand above this zone, for example) don't
			// always trigger our other layout hooks, so resync the chevron
			// position right before it becomes visible.
			this._layoutCollapseButton();
			this._updateCollapseButtonVisibility();
		});
		this.domNode.addEventListener('mouseleave', () => {
			this._wrapperHovered = false;
			this._updateCollapseButtonVisibility();
		});
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
	 * Set execution information to display in the status bar.
	 * Hides the status bar when no meaningful info is available (e.g. cached outputs).
	 */
	setExecutionInfo(state: CellExecutionState, startTime?: number, endTime?: number): void {
		// Hide status bar when idle with no timing info
		if (state === CellExecutionState.Idle && !startTime) {
			this._statusBar.style.display = 'none';
			this._stopTimer();
			this._stopTimestampRefresh();
			this._stopSparkline(true);
			this._updateStatusOnlyState();
			this._updateHeight();
			return;
		}

		// Always reset everything first to avoid stale state from previous calls
		this._statusIcon.className = 'codicon code-cell-footer-icon';
		this._statusText.textContent = '';
		dom.clearNode(this._statusText);
		this._stopTimer();
		this._stopTimestampRefresh();
		this._stopSparkline();

		this._statusBar.style.display = '';

		// Apply new state
		switch (state) {
			case CellExecutionState.Running:
				this._statusIcon.classList.add(...ThemeIcon.asClassName(Codicon.sync).split(' '), 'running');
				this._startTimer(startTime);
				this._startSparkline();
				break;
			case CellExecutionState.Queued:
				this._statusIcon.classList.add(...ThemeIcon.asClassName(Codicon.clock).split(' '), 'pending');
				this._statusText.textContent = localize('quartoQueued', 'Queued');
				break;
			case CellExecutionState.Completed:
				this._statusIcon.classList.add(...ThemeIcon.asClassName(Codicon.check).split(' '), 'success');
				this._buildDurationText(startTime, endTime);
				break;
			case CellExecutionState.Error:
				this._statusIcon.classList.add(...ThemeIcon.asClassName(Codicon.error).split(' '), 'error');
				this._buildDurationText(startTime, endTime);
				break;
			default:
				this._statusBar.style.display = 'none';
				break;
		}

		this._updateStatusOnlyState();
		this._updateHeight();
	}

	/**
	 * Build duration and timestamp text elements inside the status text span.
	 */
	private _buildDurationText(startTime?: number, endTime?: number): void {
		if (startTime && endTime) {
			const duration = endTime - startTime;
			const durationSpan = document.createElement('span');
			durationSpan.className = 'code-cell-footer-duration has-separator';
			durationSpan.textContent = formatCellDuration(duration);
			this._statusText.appendChild(durationSpan);

			const timestampSpan = document.createElement('span');
			timestampSpan.textContent = getRelativeTime(endTime);
			this._statusText.appendChild(timestampSpan);

			// Subscribe to the shared timestamp tick so "just now"
			// naturally transitions to "1 min ago", etc.
			this._stopTimestampRefresh();
			if (this._onTimestampTick) {
				this._timestampRefreshDisposable = this._onTimestampTick(() => {
					timestampSpan.textContent = getRelativeTime(endTime);
				});
			}
		}
	}

	/**
	 * Stop listening for timestamp refresh ticks.
	 */
	private _stopTimestampRefresh(): void {
		this._timestampRefreshDisposable?.dispose();
		this._timestampRefreshDisposable = undefined;
	}

	/**
	 * Start a live timer that updates the status text every 100ms with
	 * the elapsed execution time.
	 */
	private _startTimer(startTime?: number): void {
		this._executionStartTime = startTime ?? Date.now();

		// Build the duration span (same structure as completed state)
		const durationSpan = document.createElement('span');
		durationSpan.className = 'code-cell-footer-duration';
		durationSpan.textContent = '0.0s';
		dom.clearNode(this._statusText);
		this._statusText.appendChild(durationSpan);

		// Format elapsed time always in seconds (no ms) to avoid jumpy transitions
		const formatElapsed = (ms: number): string => {
			const minutes = Math.floor(ms / 1000 / 60);
			const seconds = Math.floor(ms / 1000) % 60;
			const tenths = Math.floor((ms % 1000) / 100);
			if (minutes > 0) {
				return `${minutes}m ${seconds}.${tenths}s`;
			}
			return `${seconds}.${tenths}s`;
		};

		const targetWindow = dom.getWindow(this.domNode);
		this._timerInterval = targetWindow.setInterval(() => {
			const elapsed = Date.now() - this._executionStartTime!;
			durationSpan.textContent = formatElapsed(elapsed);
		}, 100);
	}

	/**
	 * Stop the live timer.
	 */
	private _stopTimer(): void {
		if (this._timerInterval !== undefined) {
			dom.getWindow(this.domNode).clearInterval(this._timerInterval);
			this._timerInterval = undefined;
		}
		this._executionStartTime = undefined;
	}

	/**
	 * Height and width of the sparkline graph in the status bar.
	 */
	private static readonly SPARKLINE_HEIGHT = 16;
	private static readonly SPARKLINE_WIDTH = 80;

	/**
	 * Start showing the CPU sparkline in the status bar during execution.
	 */
	private _startSparkline(): void {
		if (!this._session) {
			return;
		}

		// Clear any pending fade-out from a previous execution
		if (this._sparklineFadeOutTimeout) {
			clearTimeout(this._sparklineFadeOutTimeout);
			this._sparklineFadeOutTimeout = undefined;
		}

		const maxPoints = Math.floor(QuartoOutputViewZone.SPARKLINE_WIDTH / 2) + 1;

		// Seed with historical data from the resource usage history service
		this._resourceUsageData = [];
		const generation = ++this._sparklineGeneration;
		if (this._resourceUsageHistoryService) {
			this._resourceUsageHistoryService.getHistory(this._session.sessionId).then(history => {
				// Discard results if sparkline was stopped or restarted
				if (this._sparklineGeneration !== generation) {
					return;
				}
				if (history.length > 0) {
					this._resourceUsageData = history.slice(-maxPoints);
					this._renderSparkline();
					this._updateCpuLabel();
				}
			}, _err => {
				// History unavailable; leave sparkline empty
			});
		}

		// Show containers (initially invisible via CSS opacity: 0)
		this._sparklineContainer.style.display = '';
		this._sparklineContainer.classList.remove('sparkline-visible');
		this._cpuLabel.style.display = '';
		this._cpuLabel.classList.remove('sparkline-visible');

		// Create React renderer for the sparkline
		if (!this._sparklineRenderer) {
			this._sparklineRenderer = new PositronReactRenderer(this._sparklineContainer);
		}
		this._renderSparkline();

		// Subscribe to resource usage updates from the session
		this._resourceUsageDisposables.clear();
		this._resourceUsageDisposables.add(
			this._session.onDidUpdateResourceUsage((usage) => {
				this._resourceUsageData.push(usage);
				if (this._resourceUsageData.length > maxPoints) {
					this._resourceUsageData = this._resourceUsageData.slice(-maxPoints);
				}
				this._renderSparkline();
				this._updateCpuLabel();
			})
		);

		// Delay appearance by 200ms, then fade in over 400ms (via CSS transition)
		this._sparklineDelayTimeout = setTimeout(() => {
			this._sparklineDelayTimeout = undefined;
			if (this._sparklineGeneration !== generation) {
				return;
			}
			this._sparklineContainer.classList.add('sparkline-visible');
			this._cpuLabel.classList.add('sparkline-visible');
		}, 200);
	}

	/**
	 * Stop showing the CPU sparkline and clean up.
	 */
	private _stopSparkline(immediate?: boolean): void {
		// Cancel any pending delay timer
		if (this._sparklineDelayTimeout) {
			clearTimeout(this._sparklineDelayTimeout);
			this._sparklineDelayTimeout = undefined;
		}

		this._sparklineGeneration++;
		this._resourceUsageDisposables.clear();

		if (immediate || !this._sparklineContainer.classList.contains('sparkline-visible')) {
			// Immediate cleanup (dispose, clear output, or never became visible)
			this._cleanupSparkline();
			return;
		}

		// Fade out over 400ms (via CSS transition), then clean up
		this._sparklineContainer.classList.remove('sparkline-visible');
		this._cpuLabel.classList.remove('sparkline-visible');
		this._sparklineFadeOutTimeout = setTimeout(() => {
			this._sparklineFadeOutTimeout = undefined;
			this._cleanupSparkline();
		}, 400);
	}

	/**
	 * Immediately tear down sparkline DOM and state.
	 */
	private _cleanupSparkline(): void {
		if (this._sparklineFadeOutTimeout) {
			clearTimeout(this._sparklineFadeOutTimeout);
			this._sparklineFadeOutTimeout = undefined;
		}
		if (this._sparklineRenderer) {
			this._sparklineRenderer.dispose();
			this._sparklineRenderer = undefined;
		}
		dom.clearNode(this._sparklineContainer);
		this._sparklineContainer.style.display = 'none';
		this._sparklineContainer.classList.remove('sparkline-visible');
		this._cpuLabel.style.display = 'none';
		this._cpuLabel.classList.remove('sparkline-visible');
		this._cpuLabel.textContent = '';
		this._resourceUsageData = [];
	}

	/**
	 * Render the sparkline graph with current data.
	 */
	private _renderSparkline(): void {
		if (!this._sparklineRenderer) {
			return;
		}
		this._sparklineRenderer.render(
			React.createElement(ResourceUsageGraph, {
				data: this._resourceUsageData,
				width: QuartoOutputViewZone.SPARKLINE_WIDTH,
				height: QuartoOutputViewZone.SPARKLINE_HEIGHT,
			})
		);
	}

	/**
	 * Update the CPU percentage label from the latest resource usage data point.
	 */
	private _updateCpuLabel(): void {
		if (this._resourceUsageData.length > 0) {
			const latest = this._resourceUsageData[this._resourceUsageData.length - 1];
			this._cpuLabel.textContent = `CPU ${Math.round(latest.cpu_percent)}%`;
		}
	}

	/**
	 * Update the status-only CSS class based on whether we have outputs.
	 */
	private _updateStatusOnlyState(): void {
		const hasStatus = this._statusBar.style.display !== 'none';
		const hasOutputs = this._outputs.length > 0;
		this._isStatusOnly = hasStatus && !hasOutputs;
		this._styledContainer.classList.toggle('quarto-output-status-only', this._isStatusOnly);
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
	 * Update the document URI for this view zone.
	 */
	setDocumentUri(documentUri: URI | undefined): void {
		this._documentUri = documentUri;
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
			this._imageDimensions.clear();
			dom.clearNode(this._outputContainer);
			this._disposeAllWebviews();
			this._disposeAllReactRenderers();
			this.setRecomputing(false);
			// Fresh outputs on re-execution: expand so the user sees them.
			if (this._isCollapsed) {
				this.setCollapsed(false);
			}
		}

		// When an error output arrives, remove the preceding stderr output
		// if it's redundant. R (and some other runtimes) send the error text
		// as both a stderr stream message and a structured error message,
		// which would otherwise render the same content twice.
		const hasError = output.items.some(
			i => i.mime === 'application/vnd.code.notebook.error'
		);
		if (hasError && this._outputs.length > 0) {
			const prev = this._outputs[this._outputs.length - 1];
			const isStderr = prev.items.length === 1 &&
				prev.items[0].mime === 'application/vnd.code.notebook.stderr';
			if (isStderr) {
				this._outputs.pop();
				const lastChild = this._outputContainer.lastElementChild;
				if (lastChild) {
					this._outputContainer.removeChild(lastChild);
				}
			}
		}

		this._outputs.push(output);
		this._renderOutput(output);
		this._updateStatusOnlyState();
		if (this._isCollapsed) {
			this._summaryElement.textContent = this._buildSummary();
		}
		this._updateHeight();
		this._announceOutput(output);
	}

	/**
	 * Set all outputs, replacing existing ones.
	 */
	setOutputs(outputs: ICellOutput[]): void {
		this._outputs = [...outputs];
		this._imageDimensions.clear();
		this._renderAllOutputs();
		if (this._isCollapsed) {
			this._summaryElement.textContent = this._buildSummary();
		}
		this._updateHeight();
	}

	/**
	 * Clear all outputs and hide the view zone.
	 * Called when the user clicks the close button.
	 */
	clearOutputs(): void {
		this._outputs = [];
		this._imageDimensions.clear();
		dom.clearNode(this._outputContainer);

		// Dispose all webviews and React renderers
		this._disposeAllWebviews();
		this._disposeAllReactRenderers();

		// Reset recomputing state
		this._isRecomputing = false;
		this._styledContainer.classList.remove('quarto-output-recomputing');

		// Reset collapse state so the next output starts expanded
		const wasCollapsed = this._isCollapsed;
		this._isCollapsed = false;
		this._styledContainer.classList.remove('quarto-output-collapsed');
		this._collapseChevronIcon.classList.remove('collapsed');
		const collapseLabel = localize('quartoCollapseOutput', 'Collapse Output');
		this._collapseButton.setAttribute('aria-label', collapseLabel);
		this._collapseButton.setAttribute('aria-expanded', 'true');
		this._collapseButtonHover?.update(collapseLabel);
		if (wasCollapsed) {
			this._onDidChangeCollapsed.fire(false);
		}

		// Hide the status bar and stop any running timer/sparkline.
		// This is an explicit user action to dismiss the output, so the
		// status line should be cleared too.
		this._statusBar.style.display = 'none';
		this._stopTimer();
		this._stopTimestampRefresh();
		this._stopSparkline(true);

		this._isStatusOnly = false;
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
	 * Dispose all React renderers managed by this view zone.
	 */
	private _disposeAllReactRenderers(): void {
		for (const renderer of this._reactRenderersByOutputId.values()) {
			renderer.dispose();
		}
		this._reactRenderersByOutputId.clear();
	}

	/**
	 * Check if inline data explorer is enabled in configuration.
	 */
	private _isDataExplorerEnabled(): boolean {
		if (!this._configurationService) {
			return true; // Default to enabled if no config service
		}
		return this._configurationService.getValue<boolean>(
			POSITRON_NOTEBOOK_INLINE_DATA_EXPLORER_ENABLED_KEY
		) ?? true;
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
				this._layoutCollapseButton();
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

		// Portal the chevron into the editor's container node and position it.
		this._attachCollapseButton();
		this._updateCollapseButtonVisibility();
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
		this._detachCollapseButton();
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
		this._stopTimer();
		this._stopTimestampRefresh();
		this._stopSparkline(true);
		if (this._webviewLayoutFrame !== undefined) {
			dom.getWindow(this.domNode).cancelAnimationFrame(this._webviewLayoutFrame);
			this._webviewLayoutFrame = undefined;
		}
		this._disposeResizeObserver();
		this._disposeAllWebviews();
		this._disposeAllReactRenderers();
		if (this._copyButtonTimeout) {
			clearTimeout(this._copyButtonTimeout);
		}
		if (this._hideChevronTimeout) {
			clearTimeout(this._hideChevronTimeout);
			this._hideChevronTimeout = undefined;
		}
		this._detachCollapseButton();
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

	private _createCollapseButton(): HTMLButtonElement {
		const button = document.createElement('button');
		button.className = 'quarto-output-collapse-chevron';
		const collapseLabel = localize('quartoCollapseOutput', 'Collapse Output');
		button.setAttribute('aria-label', collapseLabel);
		button.setAttribute('aria-expanded', 'true');

		this._collapseChevronIcon = document.createElement('span');
		this._collapseChevronIcon.className = `${ThemeIcon.asClassName(Codicon.chevronDown)} collapse-chevron`;
		button.appendChild(this._collapseChevronIcon);

		button.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		button.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.toggleCollapsed();
		});
		button.addEventListener('mouseenter', () => {
			this._chevronHovered = true;
			this._updateCollapseButtonVisibility();
		});
		button.addEventListener('mouseleave', () => {
			this._chevronHovered = false;
			this._updateCollapseButtonVisibility();
		});
		button.addEventListener('focus', () => this._updateCollapseButtonVisibility());
		button.addEventListener('blur', () => this._updateCollapseButtonVisibility());

		// Attach a managed hover so the tooltip matches Positron notebook
		// styling (same delay, placement, and theming as the "Expand Output"
		// / "Collapse Output" tooltip on notebook cells).
		if (this._hoverService) {
			this._collapseButtonHover = this._hoverService.setupManagedHover(
				getDefaultHoverDelegate('element'),
				button,
				collapseLabel,
			);
			this._register(this._collapseButtonHover);
		}

		return button;
	}

	/**
	 * Attach the chevron to the editor's `.overflow-guard` element (portal)
	 * and position it. Called from `show()`.
	 *
	 * `.overflow-guard` is the editor's internal content-bounds container: its
	 * top-left matches the top-left of the editor's content area. We use it
	 * instead of `getContainerDomNode()` (which is the consumer-provided
	 * wrapper and may include surrounding chrome) so that absolutely-positioned
	 * children land at the right viewport offset.
	 */
	private _attachCollapseButton(): void {
		if (!this._collapseButtonParent) {
			const container = this._editor.getContainerDomNode();
			// eslint-disable-next-line no-restricted-syntax -- querying Monaco-rendered DOM, not our own
			const overflowGuard = container.querySelector('.overflow-guard') as HTMLElement | null;
			this._collapseButtonParent = overflowGuard ?? container;
		}
		if (this._collapseButton.parentElement !== this._collapseButtonParent) {
			this._collapseButtonParent.appendChild(this._collapseButton);
		}
		// Lay out immediately for a fast first paint, then again on the next
		// frame in case Monaco hasn't positioned the view zone yet.
		this._layoutCollapseButton();
		this._scheduleCollapseButtonLayout();
	}

	/**
	 * Schedule a deferred `_layoutCollapseButton` call for the next animation
	 * frame. Used after events where Monaco may not have fully laid out the
	 * view zone yet (initial show, zone repositioning, etc.).
	 */
	private _scheduleCollapseButtonLayout(): void {
		const win = dom.getWindow(this.domNode);
		win.requestAnimationFrame(() => this._layoutCollapseButton());
	}

	/**
	 * Remove the chevron from its portal parent. Called from `hide()` /
	 * `dispose()`.
	 */
	private _detachCollapseButton(): void {
		if (this._collapseButton.parentElement) {
			this._collapseButton.parentElement.removeChild(this._collapseButton);
		}
		this._wrapperHovered = false;
		this._chevronHovered = false;
		if (this._hideChevronTimeout) {
			clearTimeout(this._hideChevronTimeout);
			this._hideChevronTimeout = undefined;
		}
	}

	/**
	 * Position the portaled chevron so it sits just to the left of the
	 * styled container's top-left corner, in the editor's left gutter.
	 * Called on show / scroll / layout / height change.
	 */
	private _layoutCollapseButton(): void {
		if (!this._collapseButtonParent || !this._zoneId) {
			return;
		}
		if (this._collapseButton.parentElement !== this._collapseButtonParent) {
			return;
		}
		const parentRect = this._collapseButtonParent.getBoundingClientRect();
		const styledRect = this._styledContainer.getBoundingClientRect();

		// If the styled container hasn't been sized yet, hide the chevron.
		// Two cases produce a zero rect:
		//   1. Monaco hasn't finished placing the view zone (initial show /
		//      newly-created zone). Reschedule so we pick up the real rect
		//      on the next frame.
		//   2. Monaco scrolled the zone off-screen and set display:none on
		//      our domNode. Rescheduling here would loop every frame until
		//      the zone is visible again; instead, bail out and rely on the
		//      scroll / layout / content-size / hover handlers to re-trigger
		//      layout when the zone comes back.
		if (styledRect.width === 0 || styledRect.height === 0) {
			this._collapseButton.style.display = 'none';
			if (this.domNode.offsetParent === null) {
				return;
			}
			this._scheduleCollapseButtonLayout();
			return;
		}
		this._collapseButton.style.display = '';

		// Horizontally stack our chevron under Monaco's own fold chevron so
		// the two line up as a single column. Prefer querying the real
		// rendered fold icon (pixel-perfect) and fall back to computing
		// from layout info when none is currently visible.
		const buttonWidth = 22;
		const foldChevronCenterX = this._getFoldChevronCenterX();
		const left = foldChevronCenterX - parentRect.left - buttonWidth / 2 + 1;
		const top = styledRect.top - parentRect.top + 7;
		this._collapseButton.style.left = `${left}px`;
		this._collapseButton.style.top = `${top}px`;
	}

	/**
	 * Return the client-X center of Monaco's fold chevron column. Queries the
	 * first rendered `.codicon-folding-*` in the editor's margin overlays for
	 * pixel-perfect alignment; if none is currently rendered, falls back to
	 * computing from the editor's layout info (fold icons live in the
	 * line-decorations slot, shifted right 2px by `margin-left` in folding.css).
	 */
	private _getFoldChevronCenterX(): number {
		const editorContainer = this._editor.getContainerDomNode();
		// eslint-disable-next-line no-restricted-syntax -- querying Monaco-rendered fold icons, not our own DOM
		const foldIcon = editorContainer.querySelector<HTMLElement>(
			'.margin-view-overlays .codicon-folding-expanded, '
			+ '.margin-view-overlays .codicon-folding-collapsed, '
			+ '.margin-view-overlays .codicon-folding-manual-expanded, '
			+ '.margin-view-overlays .codicon-folding-manual-collapsed'
		);
		if (foldIcon) {
			const r = foldIcon.getBoundingClientRect();
			if (r.width > 0) {
				return r.left + r.width / 2;
			}
		}
		const layoutInfo = this._editor.getLayoutInfo();
		const editorRect = editorContainer.getBoundingClientRect();
		return editorRect.left
			+ layoutInfo.decorationsLeft
			+ layoutInfo.decorationsWidth / 2
			+ 1;
	}

	/**
	 * Apply the current visibility intent to the chevron. Shown when the
	 * user is hovering the view zone wrapper, the chevron itself, or the
	 * editor gutter next to this view zone; or when the chevron has
	 * keyboard focus. A short delay before hiding avoids flicker when
	 * moving the pointer across the small gap between the wrapper and the
	 * chevron (they live in separate DOM subtrees).
	 */
	private _updateCollapseButtonVisibility(): void {
		// Use `:focus-visible` rather than `:focus` so a mouse click (which
		// briefly focuses the button) doesn't keep the chevron visible after
		// the pointer moves away. Keyboard focus still reveals it.
		const shouldShow = this._wrapperHovered
			|| this._chevronHovered
			|| this._gutterHovered
			|| this._collapseButton.matches(':focus-visible');

		if (shouldShow) {
			if (this._hideChevronTimeout) {
				clearTimeout(this._hideChevronTimeout);
				this._hideChevronTimeout = undefined;
			}
			this._collapseButton.classList.add('visible');
			return;
		}

		if (this._hideChevronTimeout) {
			return;
		}
		this._hideChevronTimeout = setTimeout(() => {
			this._hideChevronTimeout = undefined;
			// Re-check intent at fire time in case state flipped back.
			const stillShouldShow = this._wrapperHovered
				|| this._chevronHovered
				|| this._gutterHovered
				|| this._collapseButton.matches(':focus-visible');
			if (!stillShouldShow) {
				this._collapseButton.classList.remove('visible');
			}
		}, 400);
	}

	/**
	 * Toggle the collapsed state of the output.
	 */
	toggleCollapsed(): void {
		this.setCollapsed(!this._isCollapsed);
	}

	/**
	 * Set the collapsed state. When collapsed, the output content is hidden
	 * and a textual summary is shown in its place.
	 */
	setCollapsed(collapsed: boolean): void {
		if (this._isCollapsed === collapsed) {
			return;
		}
		this._isCollapsed = collapsed;
		this._updateCollapsedState();
		this._onDidChangeCollapsed.fire(collapsed);
	}

	/**
	 * Whether the output is currently collapsed.
	 */
	get isCollapsed(): boolean {
		return this._isCollapsed;
	}

	/**
	 * Apply the current collapsed state to the DOM: toggle classes, update
	 * summary text, re-layout webviews, and recompute the view zone height.
	 */
	private _updateCollapsedState(): void {
		this._styledContainer.classList.toggle('quarto-output-collapsed', this._isCollapsed);
		this._collapseChevronIcon.classList.toggle('collapsed', this._isCollapsed);

		const label = this._isCollapsed
			? localize('quartoExpandOutput', 'Expand Output')
			: localize('quartoCollapseOutput', 'Collapse Output');
		this._collapseButton.setAttribute('aria-label', label);
		this._collapseButton.setAttribute('aria-expanded', this._isCollapsed ? 'false' : 'true');
		this._collapseButtonHover?.update(label);

		if (this._isCollapsed) {
			this._summaryElement.textContent = this._buildSummary();
		}

		this._updateHeight();

		// Webviews are absolutely positioned over their container; re-layout so
		// they either hide (zero rect when collapsed) or reappear (full rect).
		this._layoutAllWebviews();

		// Height change shifts the chevron's anchor (it tracks the styled box),
		// and visibility policy changes when collapsing.
		this._layoutCollapseButton();
		this._updateCollapseButtonVisibility();
	}

	/**
	 * Build a localized textual summary of the current outputs for display
	 * when collapsed. Each output contributes one fragment; fragments are
	 * joined with a comma. Consecutive text outputs are merged into a single
	 * fragment with their line counts summed.
	 */
	private _buildSummary(): string {
		const parts: string[] = [];
		let pendingTextLines = 0;
		const flushTextRun = () => {
			if (pendingTextLines > 0) {
				parts.push(pendingTextLines === 1
					? localize('quartoOutputSummaryTextOne', 'Text (1 line)')
					: localize('quartoOutputSummaryText', 'Text ({0} lines)', pendingTextLines.toLocaleString()));
				pendingTextLines = 0;
			}
		};

		for (const output of this._outputs) {
			const summary = this._summarizeOutput(output);
			if (!summary) {
				continue;
			}
			if (summary.kind === 'text') {
				pendingTextLines += summary.lines;
				continue;
			}
			flushTextRun();
			parts.push(summary.text);
		}
		flushTextRun();

		if (parts.length === 0) {
			return localize('quartoOutputSummaryGeneric', 'Output');
		}
		return parts.join(', ');
	}

	/**
	 * Compute a short summary fragment for a single output, picking the
	 * most representative MIME type. Text outputs return their line count so
	 * the caller can merge consecutive runs; everything else returns a
	 * pre-localized string.
	 */
	private _summarizeOutput(output: ICellOutput): { kind: 'text'; lines: number } | { kind: 'other'; text: string } | undefined {
		// Data frame (inline data explorer)
		const dataExplorerItem = output.items.find(
			item => item.mime === DATA_EXPLORER_MIME_TYPE
		);
		if (dataExplorerItem && this._isDataExplorerEnabled()) {
			try {
				const payload = JSON.parse(dataExplorerItem.data) as { shape?: { rows: number } };
				const rows = payload.shape?.rows;
				if (typeof rows === 'number') {
					return {
						kind: 'other',
						text: rows === 1
							? localize('quartoOutputSummaryDataFrameOne', 'Data frame (1 row)')
							: localize('quartoOutputSummaryDataFrame', 'Data frame ({0} rows)', rows.toLocaleString()),
					};
				}
			} catch {
				// Fall through to other summarizers
			}
			return { kind: 'other', text: localize('quartoOutputSummaryDataFrameGeneric', 'Data frame') };
		}

		// Interactive output (widget / plotly / viewer)
		if (output.webviewMetadata?.webviewType) {
			return { kind: 'other', text: localize('quartoOutputSummaryInteractive', 'Interactive output') };
		}

		// Plot / image
		const imageItem = output.items.find(item => item.mime.startsWith('image/'));
		if (imageItem) {
			const dims = this._imageDimensions.get(output.outputId);
			if (dims) {
				return { kind: 'other', text: localize('quartoOutputSummaryPlot', 'Plot ({0}\u00D7{1})', dims.width, dims.height) };
			}
			return { kind: 'other', text: localize('quartoOutputSummaryPlotGeneric', 'Plot') };
		}

		// Error
		if (output.items.some(item => item.mime === 'application/vnd.code.notebook.error')) {
			return { kind: 'other', text: localize('quartoOutputSummaryError', 'Error') };
		}

		// Markdown
		if (output.items.some(item => item.mime === 'text/markdown')) {
			return { kind: 'other', text: localize('quartoOutputSummaryMarkdown', 'Markdown') };
		}

		// HTML (non-webview)
		if (output.items.some(item => item.mime === 'text/html')) {
			return { kind: 'other', text: localize('quartoOutputSummaryHtml', 'HTML') };
		}

		// Text (stdout / stderr / plain)
		const textItem = output.items.find(item =>
			item.mime === 'application/vnd.code.notebook.stdout' ||
			item.mime === 'application/vnd.code.notebook.stderr' ||
			item.mime === 'text/plain'
		);
		if (textItem) {
			return { kind: 'text', lines: ANSIOutput.processOutput(textItem.data).length };
		}

		return undefined;
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
				const stack = (errorData.stack || '').trim();
				const name = (errorData.name || '').trim();
				const message = (errorData.message || '').trim();

				if (stack && name && stack.startsWith(name)) {
					return stack;
				} else if (stack && stack !== message) {
					const header = name ? `${name}: ${message}` : message;
					return header ? `${header}\n${stack}` : stack;
				} else {
					return name ? `${name}: ${message}` : (message || stack);
				}
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
				case 'c':
				case 'C': {
					// Bare 'c' toggles collapsed. Skip when any modifier is held
					// so Ctrl/Cmd+C copy still works, and skip when focus is in
					// an input-like element so typing isn't hijacked.
					if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) {
						break;
					}
					const target = e.target as HTMLElement | null;
					if (target && (
						target.tagName === 'INPUT' ||
						target.tagName === 'TEXTAREA' ||
						target.isContentEditable
					)) {
						break;
					}
					this.toggleCollapsed();
					e.preventDefault();
					break;
				}
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

		this._resizeObserver.observe(this._styledContainer);
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
				this._anchorWebview(webview, container);
			}
		}
	}

	/**
	 * Anchor an output webview over its placeholder container and clip it to the
	 * editor.
	 *
	 * When the view zone is not on-screen, anchoring to its placeholder would
	 * leave the overlay "stuck" in the editor corner (see
	 * {@link isWebviewOverlayShown}). In that case we hide the overlay instead,
	 * and show + re-anchor it once the zone is on-screen again.
	 */
	private _anchorWebview(webview: INotebookOutputWebview, container: HTMLElement): void {
		const overlay = webview.webview.container;
		if (!this._isCollapsed && isWebviewOverlayShown(this.domNode, container)) {
			overlay.style.visibility = 'visible';
			webview.webview.setAnchorElement(container, this._clippingContainer);
		} else {
			overlay.style.visibility = 'hidden';
		}
	}

	/**
	 * Re-evaluate overlay visibility on the next animation frame.
	 *
	 * A layout change (scroll, height update, first render) updates the view
	 * zone's `monaco-visible-view-zone` attribute in Monaco's own render pass,
	 * which runs asynchronously after the triggering event. Reading the attribute
	 * synchronously in the event handler can therefore be stale, and a static
	 * output (e.g. a flextable table) emits no follow-up event to correct it.
	 * Re-checking next frame reads the settled attribute. Unlike a deferred
	 * geometry read, a deferred attribute read stays correct: the attribute is
	 * stable once Monaco settles, so this does not fight the immediate updates
	 * done during scrolling.
	 */
	private _scheduleWebviewLayout(): void {
		if (this._webviewLayoutFrame !== undefined) {
			return;
		}
		const win = dom.getWindow(this.domNode);
		this._webviewLayoutFrame = win.requestAnimationFrame(() => {
			this._webviewLayoutFrame = undefined;
			this._layoutAllWebviews();
		});
	}

	private _renderAllOutputs(): void {
		this._disposeAllWebviews();
		this._disposeAllReactRenderers();
		dom.clearNode(this._outputContainer);

		for (const output of this._outputs) {
			this._renderOutput(output);
		}
	}

	private _renderOutput(output: ICellOutput): void {
		const outputElement = document.createElement('div');
		outputElement.className = 'quarto-output-item';
		outputElement.setAttribute('role', 'log');

		// Check for data explorer MIME type
		const dataExplorerItem = output.items.find(
			item => item.mime === DATA_EXPLORER_MIME_TYPE
		);

		if (dataExplorerItem && this._isDataExplorerEnabled()) {
			this._renderDataExplorerOutput(dataExplorerItem, output, outputElement);
		} else if (output.webviewMetadata?.webviewType && this._webviewService && this._session) {
			// Check if this output needs webview rendering
			// Render via webview for interactive/complex outputs
			this._renderWebviewOutput(output, outputElement);
		} else if (output.webviewMetadata?.webviewType && (!this._webviewService || !this._session)) {
			// Output needs webview but session/service not available yet.
			// Show a placeholder; setSession() will trigger re-render when session arrives.
			const placeholder = document.createElement('div');
			placeholder.className = 'quarto-output-webview-container';
			placeholder.style.minHeight = '100px';
			const loadingIndicator = document.createElement('div');
			loadingIndicator.className = 'quarto-output-loading';
			loadingIndicator.textContent = localize('loadingOutput', 'Loading output...');
			placeholder.appendChild(loadingIndicator);
			outputElement.appendChild(placeholder);
		} else {
			// Determine if we should skip text/plain because a richer
			// representation is available (same logic as quartoExecutionManager).
			const hasHtml = output.items.some(i => i.mime === 'text/html');
			const hasImage = output.items.some(i => i.mime.startsWith('image/'));
			const hasDataExplorer = output.items.some(i => i.mime === DATA_EXPLORER_MIME_TYPE);
			const shouldExcludePlainText = (hasHtml || hasImage) && !hasDataExplorer;

			// Render items normally, skipping data explorer MIME
			for (const item of output.items) {
				if (item.mime === DATA_EXPLORER_MIME_TYPE) {
					continue;
				}
				if (item.mime === 'text/plain' && shouldExcludePlainText) {
					continue;
				}
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
			return this._renderImage(mime, data, output.outputId);
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

	/**
	 * Render a data explorer output using a React component bridge.
	 */
	private _renderDataExplorerOutput(
		dataExplorerItem: ICellOutputItem,
		output: ICellOutput,
		container: HTMLElement
	): void {
		// Parse the data explorer payload
		let payload: {
			comm_id?: string;
			shape?: { rows: number; columns: number };
			title?: string;
			variable_path?: unknown;
		};
		try {
			payload = JSON.parse(dataExplorerItem.data);
		} catch {
			// If parsing fails, fall back to rendering other items
			this._renderDataExplorerFallback(output, container);
			return;
		}

		const commId = payload.comm_id;
		const shape = payload.shape;
		const title = payload.title ?? 'DataFrame';

		if (!commId || !shape) {
			this._renderDataExplorerFallback(output, container);
			return;
		}

		const variablePath = parseVariablePath(payload.variable_path);

		const maxHeight = this._configurationService?.getValue<number>(
			POSITRON_NOTEBOOK_INLINE_DATA_EXPLORER_MAX_HEIGHT_KEY
		) ?? 300;
		const height = calculateInlineDataExplorerHeight(shape.rows, maxHeight);

		// Create a container for the React component
		const dataExplorerContainer = document.createElement('div');
		dataExplorerContainer.className = 'quarto-output-data-explorer';
		dataExplorerContainer.style.height = `${height}px`;
		dataExplorerContainer.style.overflow = 'hidden';
		container.appendChild(dataExplorerContainer);

		// Create a React renderer and render the component
		const renderer = new PositronReactRenderer(dataExplorerContainer);
		this._reactRenderersByOutputId.set(output.outputId, renderer);

		const handleFallback = () => {
			// Dispose the React renderer
			renderer.dispose();
			this._reactRenderersByOutputId.delete(output.outputId);

			// Clear the container and render HTML fallback
			dom.clearNode(dataExplorerContainer);
			dataExplorerContainer.style.height = '';
			dataExplorerContainer.style.overflow = '';
			dataExplorerContainer.className = '';
			this._renderDataExplorerFallback(output, container);

			// Remove the now-empty data explorer container
			if (dataExplorerContainer.parentNode) {
				dataExplorerContainer.parentNode.removeChild(dataExplorerContainer);
			}

			this._updateHeight();
		};

		const handleHeightChange = (newHeight: number) => {
			dataExplorerContainer.style.height = `${newHeight}px`;
			this._updateHeight();
		};

		renderer.render(
			React.createElement(QuartoInlineDataExplorer, {
				commId,
				shape,
				title,
				variablePath,
				documentUri: this._documentUri ?? URI.parse(''),
				onFallback: handleFallback,
				onHeightChange: handleHeightChange,
			})
		);
	}

	/**
	 * Render fallback content for a data explorer output (text or HTML).
	 * Prefers text/plain because the R kernel's text/html for data frames
	 * is currently a stub; text/plain contains the actual formatted output.
	 */
	private _renderDataExplorerFallback(output: ICellOutput, container: HTMLElement): void {
		// Prefer text/plain - it contains the actual console representation
		const textItem = output.items.find(item => item.mime === 'text/plain');
		if (textItem) {
			const rendered = this._renderText(textItem.data, 'stdout');
			container.appendChild(rendered);
			return;
		}

		// Fall back to HTML
		const htmlItem = output.items.find(item => item.mime === 'text/html');
		if (htmlItem) {
			const rendered = this._renderHtml(htmlItem.data, output);
			if (rendered) {
				container.appendChild(rendered);
			}
		}
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
			// Apply styles.
			if (run.format.styles) {
				const css = computeAnsiStyles(run.format.styles);
				for (const key of Object.keys(css)) {
					span.style.setProperty(key, css[key]);
				}
			}

			// Apply foreground color.
			if (run.format.foregroundColor) {
				const color = resolveAnsiColor(run.format.foregroundColor);
				if (color) {
					span.style.color = color;
				}
			}

			// Apply background color.
			if (run.format.backgroundColor) {
				const color = resolveAnsiColor(run.format.backgroundColor);
				if (color) {
					span.style.backgroundColor = color;
				}
			}
		}

		return span;
	}

	private _renderError(data: string): HTMLElement {
		const container = document.createElement('div');
		container.className = 'quarto-output-error';
		container.setAttribute('role', 'alert');

		let errorText: string;
		try {
			const errorData = JSON.parse(data);

			// Prefer the stack/traceback when available: it is the most
			// complete representation and preserves ANSI formatting that
			// runtimes (especially R) use for colors and bold text.
			// Only fall back to name+message when no stack is provided.
			const stack = (errorData.stack || '').trim();
			if (stack) {
				errorText = stack;
			} else if (errorData.name) {
				errorText = `${errorData.name}: ${errorData.message || ''}`;
			} else {
				errorText = errorData.message || '';
			}
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

	private _renderImage(mime: string, data: string, outputId: string): HTMLElement {
		const container = document.createElement('div');
		container.className = 'quarto-output-image-container';

		const img = document.createElement('img');
		img.className = 'quarto-output-image';
		img.setAttribute('alt', localize('outputImage', 'Output image'));

		// Cache the natural dimensions once the image loads so the collapse
		// summary can show "Plot (WxH)".
		img.addEventListener('load', () => {
			this._imageDimensions.set(outputId, {
				width: img.naturalWidth,
				height: img.naturalHeight,
			});
			if (this._isCollapsed) {
				this._summaryElement.textContent = this._buildSummary();
			}
		});

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

		// Active HTML is sandboxed in a raw-HTML webview, which is built from the
		// static content alone and needs no runtime session -- so cached R HTML
		// widgets restore as webviews after a reload before any kernel reattaches
		// (posit-dev/positron#14559).
		switch (chooseHtmlRenderMode(content, !!this._webviewService)) {
			case 'inline':
				safeSetInnerHtml(container, content);
				break;
			case 'webview':
				container.className = 'quarto-output-webview-container';
				this._renderHtmlInWebview(content, output, container);
				break;
			case 'warning': {
				// No webview service available: render as escaped text with a warning.
				const warning = document.createElement('div');
				warning.className = 'quarto-output-warning';
				warning.textContent = localize('unsafeHtml', 'Interactive HTML output (requires webview)');
				container.appendChild(warning);

				const pre = document.createElement('pre');
				pre.className = 'quarto-output-html-escaped';
				pre.textContent = content.substring(0, 500) + (content.length > 500 ? '...' : '');
				container.appendChild(pre);
				break;
			}
		}

		return container;
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
			this._anchorWebview(webview, webviewContainer);

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
					this._anchorWebview(webview, webviewContainer);
					// The height change re-lays out the zone asynchronously; re-check
					// visibility once Monaco settles so the overlay shows on load.
					this._scheduleWebviewLayout();
				}
			}));

			// Update height when webview renders
			this._webviewDisposables.add(webview.onDidRender(() => {
				this._updateHeight();
				this._anchorWebview(webview, webviewContainer);
				this._scheduleWebviewLayout();
			}));

			// Handle scroll events - update webview position
			// Note: onDomNodeTop provides more immediate updates during scrolling,
			// but we keep this as a backup for any scroll events that might be missed
			this._webviewDisposables.add(this._editor.onDidScrollChange(() => {
				if (this._zoneId) {
					this._anchorWebview(webview, webviewContainer);
					this._scheduleWebviewLayout();
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
		// A raw-HTML webview renders static content and needs no runtime session,
		// so it can be built when restoring cached output before a kernel
		// reattaches (posit-dev/positron#14559).
		if (!this._webviewService) {
			return;
		}

		// Show loading indicator
		const loadingIndicator = document.createElement('div');
		loadingIndicator.className = 'quarto-output-loading';
		loadingIndicator.textContent = localize('loadingOutput', 'Loading output...');
		container.appendChild(loadingIndicator);

		try {
			// Resolve relative assets against the document's directory when it
			// lives on disk (untitled documents have no meaningful base).
			const baseUri = this._documentUri && this._documentUri.scheme !== Schemas.untitled
				? dirname(this._documentUri)
				: undefined;

			// Render raw HTML content as a self-contained document (i.e. an R
			// leaflet map). Using `createNotebookOutputWebview()` would find the
			// built-in renderer for `text/html` and flatten the self-contained
			// document, dropping `<head>` and scripts.
			const webview = await this._webviewService.createRawHtmlOutputWebview(
				output.outputId,
				content,
				baseUri,
			);

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
			this._anchorWebview(webview, container);

			// Listen for webview messages to get the actual content height
			this._webviewDisposables.add(webview.webview.onMessage(({ message }) => {
				if (isHTMLOutputWebviewMessage(message) && container) {
					const maxHeight = 800;
					const boundedHeight = Math.min(message.bodyScrollHeight, maxHeight);
					container.style.height = `${boundedHeight}px`;
					this._updateHeight();
					this._anchorWebview(webview, container);
					// The height change re-lays out the zone asynchronously; re-check
					// visibility once Monaco settles so the overlay shows on load.
					this._scheduleWebviewLayout();
				}
			}));

			// Update height when webview renders
			this._webviewDisposables.add(webview.onDidRender(() => {
				this._updateHeight();
				this._anchorWebview(webview, container);
				this._scheduleWebviewLayout();
			}));

			// Handle scroll events
			// Note: onDomNodeTop provides more immediate updates during scrolling,
			// but we keep this as a backup for any scroll events that might be missed
			this._webviewDisposables.add(this._editor.onDidScrollChange(() => {
				if (this._zoneId) {
					this._anchorWebview(webview, container);
					this._scheduleWebviewLayout();
				}
			}));

		} catch (error) {
			container.removeChild(loadingIndicator);
			const errorDiv = document.createElement('div');
			errorDiv.className = 'quarto-output-error';
			errorDiv.textContent = localize('webviewHtmlError', 'Failed to render HTML: {0}', String(error));
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
		// When Monaco scrolls the view zone off-screen, it sets display:none on
		// our domNode. offsetHeight returns 0 in that state, which would
		// incorrectly shrink the whitespace to MIN_VIEW_ZONE_HEIGHT. On the
		// next scroll back, the whitespace would jump from 24px to the real
		// height, causing a large scroll displacement. Skip measurement when
		// the domNode is hidden to preserve the correct height.
		if (!this.domNode.offsetHeight) {
			return;
		}

		// Measure the styled container's height (content + padding + border, but not margin)
		// plus the status bar height when it's displayed above the output
		const statusBarHeight = this._statusBar.style.display !== 'none' ? this._statusBar.offsetHeight : 0;
		const styledHeight = this._styledContainer.offsetHeight + statusBarHeight;

		// Use the styled container's height (not including status bar) for button
		// visibility, since the buttons are positioned inside the styled container
		const containerHeight = this._styledContainer.offsetHeight;

		if (this._isCollapsed) {
			// Hide action buttons when collapsed since they operate on the
			// (now hidden) output content.
			this._copyButton.style.display = 'none';
			this._popoutButton.style.display = 'none';
			this._saveButton.style.display = 'none';
		} else {
			// Show the Copy button if there's enough room and there's copiable content
			// Copy is prioritized (shown first) since it's the most common action
			this._copyButton.style.display = containerHeight > 40 && this.hasCopiableContent() ? 'block' : 'none';

			// Show the Popout button if there's more room and there's popout content
			// (not just errors - plot, HTML, or text content)
			this._popoutButton.style.display = containerHeight > 80 && this.hasPopoutContent() ? 'block' : 'none';

			// Show the Save button if there's even more room and there's exactly one plot
			this._saveButton.style.display = containerHeight > 100 && this.hasSinglePlot() ? 'block' : 'none';
		}

		// Add margin space (4px top + 4px bottom) plus 5px spacing below the widget
		const newHeight = Math.max(MIN_VIEW_ZONE_HEIGHT, styledHeight + 13);

		if (newHeight !== this.heightInPx && this._zoneId) {
			this.heightInPx = newHeight;

			// Use layoutZone to update the height in-place without
			// removing and re-adding the zone (which causes flicker)
			this._editor.changeViewZones(accessor => {
				accessor.layoutZone(this._zoneId!);
			});
		} else if (!this._zoneId) {
			this.heightInPx = newHeight;
		}

		// The portaled chevron tracks the styled box's top-left; any height
		// or width change shifts that anchor.
		this._layoutCollapseButton();
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
